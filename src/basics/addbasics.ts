/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import * as Encryption from "crypto";
import { Log, Crypto, Transaction } from "@coinversable/validana-core";
import { RequestHandler } from "../core/requesthandler";
import { Database, DBTransaction } from "../core/database";
import { ServerCache } from "../core/servercache";
import { BasicRequestTypes, ProcessRequest, TxRequest, Contract, TxResponseOrPush, BasicPushTypes, TxStatusResponse, TxResponse, TxStatusesResponse } from "./basicapi";
import { ServerEventEmitter } from "../core/events";
import { Metrics } from "../core/metrics";
import { Config } from "../config";
import { Message } from "../protocol/protocol";

/**
 * We use a pattern close to mixins: https://www.typescriptlang.org/docs/handbook/mixins.html
 * The difference is here typescript will correctly determine the class without us having to do anything.
 *
 * This is basically the same as 'export class Basics extends RequestHandler', except we can choose
 *  what subclass of RequestHandler we want to apply this to, allowing us to create modules.
 */
// tslint:disable-next-line:typedef Let typescript determine the type...
export function addBasics<T extends new (...args: any[]) => RequestHandler>(Extend: T) {
	return class Basics extends Extend {
		/** Get all contracts. */
		protected static readonly getContracts = `SELECT encode(contract_hash, 'hex') AS hash, contract_type AS type, contract_version AS version, `
			+ `description, contract_template AS template, validana_version AS "validanaVersion" FROM basics.contracts;`;
		/** Store a transaction in the database. */
		protected static readonly storeTransaction = "INSERT INTO basics.transactions(version, transaction_id, contract_hash, "
			+ "valid_till, payload, signature, public_key, create_ts) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);";
		/** Get the last processed block (if any). */
		protected static readonly getLatestBlockTs = "SELECT processed_ts FROM basics.blocks ORDER BY block_id DESC LIMIT 1;";
		/** Get one or more transactions. */
		protected static readonly getTxs = "SELECT * FROM basics.transactions WHERE transaction_id = ANY($1) AND processed_ts IS NOT NULL;";
		/** Get one or more transaction statusus. */
		protected static readonly getTxsStatus = "SELECT transaction_id, status, message " +
			"FROM basics.transactions WHERE transaction_id = ANY($1) AND processed_ts IS NOT NULL;";

		//No longer used internally, available for backwards compatibility.
		/** Get a single transaction. */
		protected static readonly getTx = "SELECT * FROM basics.transactions WHERE transaction_id = $1;";
		/** Get the status of a single transaction. */
		protected static readonly getTxStatus = "SELECT transaction_id, status, message FROM basics.transactions WHERE transaction_id = $1;";

		constructor(..._: any[]) {
			super();

			//Cache all contracts as they are frequently requested, but rarely change.
			ServerCache.add("contracts", async () => (await Database.get().query(Basics.getContracts)).rows);

			this.addMessageHandler(BasicRequestTypes.Contracts, this.contractsMessage);
			this.addMessageHandler(BasicRequestTypes.Process, this.processMessage);
			this.addMessageHandler(BasicRequestTypes.Time, this.timeMessage);
			this.addMessageHandler(BasicRequestTypes.Transaction, this.transactionMessage);
			this.addMessageHandler(BasicRequestTypes.TxStatus, this.txStatusMessage);
			if (Config.get().VSERVER_METRICSTOKEN !== undefined && Config.get().VSERVER_METRICSINTERVAL !== 0) {
				this.addMessageHandler(BasicRequestTypes.Metrics, this.metricsMessage, false);
			}
		}

		/** Turn a database transaction in one suitable for TxResponseOrPush. */
		protected dbTxToTxResponse(tx: DBTransaction): TxResponseOrPush {
			return {
				blockId: tx.block_id,
				version: tx.version,
				validTill: tx.valid_till,
				positionInBlock: tx.position_in_block,
				processedTs: tx.processed_ts,
				sender: tx.sender,
				receiver: tx.receiver,
				contractType: tx.contract_type,
				contractHash: Crypto.binaryToHex(tx.contract_hash),
				status: tx.status,
				message: tx.message,
				id: Crypto.binaryToHex(tx.transaction_id),
				createTs: tx.create_ts,
				signature: Crypto.binaryToHex(tx.signature),
				publicKey: Crypto.binaryToHex(tx.public_key),
				payload: tx.payload
			};
		}

		/** We were requested to process a new transaction from the client. */
		protected async processMessage(data: ProcessRequest, message: Message): Promise<void> {
			//Check if all required arguments are there and correct
			if (typeof data !== "object" || data === null || (data.createTs !== undefined && !Number.isSafeInteger(data.createTs)) ||
				typeof data.base64tx !== "string" || !Crypto.isBase64(data.base64tx)) {
				return Promise.reject("Missing or invalid request data parameters.");
			}

			let tx: Transaction;
			try {
				tx = new Transaction(Crypto.base64ToBinary(data.base64tx));
			} catch (error) {
				return Promise.reject("Invalid transaction format.");
			}

			//Fill in all fields for our database.
			const params = [
				tx.version,
				tx.getId(),
				tx.getContractHash(), //contract hash
				tx.validTill, //Valid till
				tx.getPayloadBinary().toString(), //payload
				tx.getSignature(), //signature
				tx.getPublicKeyBuffer(), //public key
				data.createTs ?? 0 //Create timestamp
			];

			try { //Store the transaction in the DB
				await Database.get().query(Basics.storeTransaction, params);
			} catch (error) {
				if (error.code === "23505") {
					//There is already a transaction with this id
					return Promise.reject("Transaction with id already exists.");
				} else {
					//Something went wrong, do not send a detailed report to the client for security reasons
					Log.error("Failed to store transaction.", error);
					return Promise.reject("Invalid format or unable to store transaction.");
				}
			}

			if (data.wait === true) {
				return new Promise((resolve, reject) => {
					ServerEventEmitter.get("transactionId").subscribe(message, (processedTx) => {
						message.latencyStart = undefined;
						if (processedTx.status === "accepted") {
							resolve();
						} else {
							message.statusCode = 422;
							reject(processedTx.message);
						}
					}, tx.getId().toString("hex"));
				});
			} else {
				message.statusCode = 202;
				return undefined;
			}
		}

		/** The client requests the smart contracts that are available. */
		protected async contractsMessage(data: { type?: string }): Promise<Contract[]> {
			//Old version
			if (typeof data !== "object") {
				data = { type: data };
			}
			//Check if all data is correct
			if (typeof data !== "object" || data === null || (data.type !== undefined && typeof data.type !== "string")) {
				return Promise.reject("Missing or invalid request data parameters.");
			}

			try { //Get all contracts
				if (data.type === undefined) {
					return await ServerCache.get("contracts");
				} else {
					return (await ServerCache.get("contracts") as Contract[]).filter((contract) => contract.type === data.type);
				}
			} catch (error) {
				//We were unable to retrieve the contracts, do not send a detailed error for security reasons.
				Log.error("Failed to retrieve contracts", error);
				return Promise.reject("Failed to retrieve contracts.");
			}
		}

		/** The client requests the status of a certain transaction. */
		protected async txStatusMessage(data: TxRequest, message: Message): Promise<TxStatusResponse> {
			//Check if all data is correct
			if (typeof data !== "object" || data === null || (data.push !== undefined && typeof data.push !== "boolean") ||
				(data.wait !== undefined && typeof data.wait !== "boolean")) {
				return Promise.reject("Missing or invalid request data parameters.");
			}
			const ids = data.txId instanceof Array ? data.txId : [data.txId];
			if (ids.length === 0 || ids.some((txId) => typeof txId !== "string" || !Crypto.isHex(txId))) {
				return Promise.reject("Missing or invalid request data parameters.");
			}

			//Register for updates for all these transactions
			const result: TxStatusesResponse[] = [];
			let returnPromise: Promise<TxStatusResponse> | undefined;
			let returnPromiseResolve: (res: TxStatusResponse) => void | undefined;
			let sendPush: boolean = false;
			if (data.wait === true) {
				//We do not return till we have all results
				returnPromise = new Promise((resolve) => {
					returnPromiseResolve = resolve;
					for (const id of ids) {
						ServerEventEmitter.get("transactionId").subscribe(message, (processedTx) => {
							//If a new transaction completes add it to the list of completed transaction.
							result.push({ id: Crypto.binaryToHex(processedTx.transaction_id), status: processedTx.status, message: processedTx.message! });
							//If all transactions completed we return the result
							if (result.length === ids.length) {
								message.latencyStart = undefined;
								resolve(typeof data.txId !== "string" ? result : result[0].status);
							}
						}, id);
					}
				});
			} else if (data.push === true && message.protocol.canPush()) {
				for (const id of ids) {
					//We send a push notification each time a new transaction completes
					ServerEventEmitter.get("transactionId").subscribe(message, (processedTx) => {
						const subResult = { id: Crypto.binaryToHex(processedTx.transaction_id), status: processedTx.status, message: processedTx.message! };
						sendPush ? message.protocol.sendPush(message, BasicPushTypes.Transaction, subResult) : result.push(subResult);
					}, id);
				}
			}

			//Get already existing transactions
			let foundTxs: DBTransaction[];
			try {
				foundTxs = (await Database.get().query(Basics.getTxsStatus, [ids.map(Crypto.hexToBinary)])).rows;
			} catch (error) {
				//We were unable to retrieve the transaction status, do not send a detailed error for security reasons.
				Log.error("Failed to retrieve transaction status", error);
				return Promise.reject("Unable to retrieve transaction status.");
			}

			//In the rare chance it has been found before our status query returned (which may or may not contain the result)
			if (result.length > 0) {
				foundTxs = foundTxs.filter((foundTx) => result.every((subResult) => subResult.id !== foundTx.transaction_id.toString("hex")));
			}
			//Add all found to the result, unsubscribe from them for further updates.
			for (const foundTx of foundTxs) {
				const hexId = Crypto.binaryToHex(foundTx.transaction_id);
				ServerEventEmitter.get("transactionId").unsubscribe(message, hexId);
				result.push({
					id: hexId,
					status: foundTx.status,
					message: foundTx.message!
				});
			}

			//Return the results we have so far (or a promise with the result)
			if (returnPromise !== undefined) {
				if (result.length === ids.length) {
					returnPromiseResolve!(typeof data.txId !== "string" ? result : result[0].status);
				}
				return returnPromise;
			} else {
				sendPush = true;
				return typeof data.txId !== "string" ? result : result[0]?.status;
			}
		}

		/** The client requests the status of a certain transaction. */
		protected async transactionMessage(data: TxRequest, message: Message): Promise<TxResponse> {
			//Check if all data is correct
			if (typeof data !== "object" || data === null || (data.push !== undefined && typeof data.push !== "boolean") ||
				(data.wait !== undefined && typeof data.wait !== "boolean")) {
				return Promise.reject("Missing or invalid request data parameters.");
			}
			const ids = data.txId instanceof Array ? data.txId : [data.txId];
			if (ids.length === 0 || ids.some((txId) => typeof txId !== "string" || !Crypto.isHex(txId))) {
				return Promise.reject("Missing or invalid request data parameters.");
			}

			//Register for push for all these transactions
			const result: TxResponseOrPush[] = [];
			let returnPromise: Promise<TxResponse> | undefined;
			let returnPromiseResolve: (res: TxResponse) => void | undefined;
			let sendPush: boolean = false;
			if (data.wait === true) {
				//We do not return till we have all results
				returnPromise = new Promise((resolve) => {
					returnPromiseResolve = resolve;
					for (const id of ids) {
						ServerEventEmitter.get("transactionId").subscribe(message, (processedTx) => {
							//If a new transaction completes add it to the list of completed transaction.
							result.push(this.dbTxToTxResponse(processedTx));
							//If all transactions completed we return the result
							if (result.length === ids.length) {
								message.latencyStart = undefined;
								resolve(typeof data.txId !== "string" ? result : result[0]);
							}
						}, id);
					}
				});
			} else if (data.push === true && message.protocol.canPush()) {
				for (const id of ids) {
					//We send a push notification each time a new transaction completes
					ServerEventEmitter.get("transactionId").subscribe(message, (processedTx) => {
						const subResult = this.dbTxToTxResponse(processedTx);
						sendPush ? message.protocol.sendPush(message, BasicPushTypes.Transaction, subResult) : result.push(subResult);
					}, id);
				}
			}

			//Get already existing transactions
			let foundTxs: DBTransaction[];
			try {
				foundTxs = (await Database.get().query(Basics.getTxs, [ids.map(Crypto.hexToBinary)])).rows;
			} catch (error) {
				//We were unable to retrieve the transaction, do not send a detailed error for security reasons.
				Log.error("Failed to retrieve transaction", error);
				return Promise.reject("Unable to retrieve transaction.");
			}

			//In the rare chance it has been found before our query returned (which may or may not contain the result)
			if (result.length > 0) {
				foundTxs = foundTxs.filter((foundTx) => result.every((subResult) => subResult.id !== foundTx.transaction_id.toString("hex")));
			}
			//Add all found to the result, unsubscribe from them for further updates.
			for (const foundTx of foundTxs) {
				const hexId = Crypto.binaryToHex(foundTx.transaction_id);
				ServerEventEmitter.get("transactionId").unsubscribe(message, hexId);
				result.push(this.dbTxToTxResponse(foundTx));
			}

			//Return the results we have so far (or a promise with the result)
			if (returnPromise !== undefined) {
				if (result.length === ids.length) {
					returnPromiseResolve!(typeof data.txId !== "string" ? result : result[0]);
				}
				return returnPromise;
			} else {
				sendPush = true;
				return typeof data.txId !== "string" ? result : result[0];
			}
		}

		/** The client requests the time of the most recent block. */
		protected async timeMessage(): Promise<number> {
			try {
				const result = (await Database.get().query(Basics.getLatestBlockTs)).rows[0];
				if (result === undefined) {
					//If our database is still empty.
					return Promise.reject("No existing blocks found.");
				} else {
					return result.processed_ts;
				}
			} catch (error) {
				Log.error("Unable to retrieve latest block.", error);
				return Promise.reject("Unable to retrieve latest block.");
			}
		}

		/** The client request the metrics of this server. */
		protected async metricsMessage(data: { format: string, token: string }, message: Message): Promise<any> {
			message.log = false;
			//Check if all required arguments are there and correct
			if (typeof data !== "object" || data === null || typeof data.format !== "string" || typeof data.token !== "string") {
				return Promise.reject("Missing or invalid request data parameters.");
			}

			//You may only view the metrics if you provide the correct token.
			const configToken = Config.get().VSERVER_METRICSTOKEN!;
			if (data.token.length !== configToken.length ||
				!Encryption.timingSafeEqual(Buffer.from(data.token), Buffer.from(configToken))) {
				message.statusCode = 401;
				return Promise.reject("Invalid token.");
			}
			if (!Metrics.syncedOnce) {
				return Promise.reject("No metrics gathered yet, please try again in a moment.");
			}
			//Do not include in latency metrics as normal users are not influenced by these requests.
			message.latencyStart = undefined;

			try {
				if (data.format === "json") {
					return Object.assign({}, ...await Metrics.export("json"));
				} else if (data.format === "prometheus") {
					const result = (await Metrics.export("prometheus")).join("\n");
					message.responseHeaders = { "Content-Type": "text/plain; charset=UTF-8" };
					return result;
				} else {
					//Export a json array with the data.
					return await Metrics.export(data.format);
				}
			} catch (error) {
				Log.error("Unable to retrieve metrics.", error);
				return Promise.reject("Unable to retrieve metrics.");
			}
		}
	};
}