"use strict";
/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
const Encryption = require("crypto");
const validana_core_1 = require("@coinversable/validana-core");
const database_1 = require("../core/database");
const servercache_1 = require("../core/servercache");
const basicapi_1 = require("./basicapi");
const events_1 = require("../core/events");
const metrics_1 = require("../core/metrics");
const config_1 = require("../config");
function addBasics(Extend) {
    var _a;
    return _a = class Basics extends Extend {
            constructor(..._) {
                super();
                servercache_1.ServerCache.add("contracts", async () => (await database_1.Database.get().query(Basics.getContracts)).rows);
                this.addMessageHandler(basicapi_1.BasicRequestTypes.Contracts, this.contractsMessage);
                this.addMessageHandler(basicapi_1.BasicRequestTypes.Process, this.processMessage);
                this.addMessageHandler(basicapi_1.BasicRequestTypes.Time, this.timeMessage);
                this.addMessageHandler(basicapi_1.BasicRequestTypes.Transaction, this.transactionMessage);
                this.addMessageHandler(basicapi_1.BasicRequestTypes.TxStatus, this.txStatusMessage);
                if (config_1.Config.get().VSERVER_METRICSTOKEN !== undefined && config_1.Config.get().VSERVER_METRICSINTERVAL !== 0) {
                    this.addMessageHandler(basicapi_1.BasicRequestTypes.Metrics, this.metricsMessage, false);
                }
            }
            dbTxToTxResponse(tx) {
                return {
                    blockId: tx.block_id,
                    version: tx.version,
                    validTill: tx.valid_till,
                    positionInBlock: tx.position_in_block,
                    processedTs: tx.processed_ts,
                    sender: tx.sender,
                    receiver: tx.receiver,
                    contractType: tx.contract_type,
                    contractHash: validana_core_1.Crypto.binaryToHex(tx.contract_hash),
                    status: tx.status,
                    message: tx.message,
                    id: validana_core_1.Crypto.binaryToHex(tx.transaction_id),
                    createTs: tx.create_ts,
                    signature: validana_core_1.Crypto.binaryToHex(tx.signature),
                    publicKey: validana_core_1.Crypto.binaryToHex(tx.public_key),
                    payload: tx.payload
                };
            }
            async processMessage(data, message) {
                var _a;
                if (typeof data !== "object" || data === null || (data.createTs !== undefined && !Number.isSafeInteger(data.createTs)) ||
                    typeof data.base64tx !== "string" || !validana_core_1.Crypto.isBase64(data.base64tx)) {
                    return Promise.reject("Missing or invalid request data parameters.");
                }
                let tx;
                try {
                    tx = new validana_core_1.Transaction(validana_core_1.Crypto.base64ToBinary(data.base64tx));
                }
                catch (error) {
                    return Promise.reject("Invalid transaction format.");
                }
                const params = [
                    tx.version,
                    tx.getId(),
                    tx.getContractHash(),
                    tx.validTill,
                    tx.getPayloadBinary().toString(),
                    tx.getSignature(),
                    tx.getPublicKeyBuffer(),
                    (_a = data.createTs, (_a !== null && _a !== void 0 ? _a : 0))
                ];
                try {
                    await database_1.Database.get().query(Basics.storeTransaction, params);
                }
                catch (error) {
                    if (error.code === "23505") {
                        return Promise.reject("Transaction with id already exists.");
                    }
                    else {
                        validana_core_1.Log.error("Failed to store transaction.", error);
                        return Promise.reject("Invalid format or unable to store transaction.");
                    }
                }
                if (data.wait === true) {
                    return new Promise((resolve, reject) => {
                        events_1.ServerEventEmitter.get("transactionId").subscribe(message, (processedTx) => {
                            message.latencyStart = undefined;
                            if (processedTx.status === "accepted") {
                                resolve();
                            }
                            else {
                                message.statusCode = 422;
                                reject(processedTx.message);
                            }
                        }, tx.getId().toString("hex"));
                    });
                }
                else {
                    message.statusCode = 202;
                    return undefined;
                }
            }
            async contractsMessage(data) {
                if (typeof data !== "object") {
                    data = { type: data };
                }
                if (typeof data !== "object" || data === null || (data.type !== undefined && typeof data.type !== "string")) {
                    return Promise.reject("Missing or invalid request data parameters.");
                }
                try {
                    if (data.type === undefined) {
                        return await servercache_1.ServerCache.get("contracts");
                    }
                    else {
                        return (await servercache_1.ServerCache.get("contracts")).filter((contract) => contract.type === data.type);
                    }
                }
                catch (error) {
                    validana_core_1.Log.error("Failed to retrieve contracts", error);
                    return Promise.reject("Failed to retrieve contracts.");
                }
            }
            async txStatusMessage(data, message) {
                var _a;
                if (typeof data !== "object" || data === null || (data.push !== undefined && typeof data.push !== "boolean") ||
                    (data.wait !== undefined && typeof data.wait !== "boolean")) {
                    return Promise.reject("Missing or invalid request data parameters.");
                }
                const ids = data.txId instanceof Array ? data.txId : [data.txId];
                if (ids.length === 0 || ids.some((txId) => typeof txId !== "string" || !validana_core_1.Crypto.isHex(txId))) {
                    return Promise.reject("Missing or invalid request data parameters.");
                }
                const result = [];
                let returnPromise;
                let returnPromiseResolve;
                let sendPush = false;
                if (data.wait === true) {
                    returnPromise = new Promise((resolve) => {
                        returnPromiseResolve = resolve;
                        for (const id of ids) {
                            events_1.ServerEventEmitter.get("transactionId").subscribe(message, (processedTx) => {
                                result.push({ id: validana_core_1.Crypto.binaryToHex(processedTx.transaction_id), status: processedTx.status, message: processedTx.message });
                                if (result.length === ids.length) {
                                    message.latencyStart = undefined;
                                    resolve(typeof data.txId !== "string" ? result : result[0].status);
                                }
                            }, id);
                        }
                    });
                }
                else if (data.push === true && message.protocol.canPush()) {
                    for (const id of ids) {
                        events_1.ServerEventEmitter.get("transactionId").subscribe(message, (processedTx) => {
                            const subResult = { id: validana_core_1.Crypto.binaryToHex(processedTx.transaction_id), status: processedTx.status, message: processedTx.message };
                            sendPush ? message.protocol.sendPush(message, basicapi_1.BasicPushTypes.Transaction, subResult) : result.push(subResult);
                        }, id);
                    }
                }
                let foundTxs;
                try {
                    foundTxs = (await database_1.Database.get().query(Basics.getTxsStatus, [ids.map(validana_core_1.Crypto.hexToBinary)])).rows;
                }
                catch (error) {
                    validana_core_1.Log.error("Failed to retrieve transaction status", error);
                    return Promise.reject("Unable to retrieve transaction status.");
                }
                if (result.length > 0) {
                    foundTxs = foundTxs.filter((foundTx) => result.every((subResult) => subResult.id !== foundTx.transaction_id.toString("hex")));
                }
                for (const foundTx of foundTxs) {
                    const hexId = validana_core_1.Crypto.binaryToHex(foundTx.transaction_id);
                    events_1.ServerEventEmitter.get("transactionId").unsubscribe(message, hexId);
                    result.push({
                        id: hexId,
                        status: foundTx.status,
                        message: foundTx.message
                    });
                }
                if (returnPromise !== undefined) {
                    if (result.length === ids.length) {
                        returnPromiseResolve(typeof data.txId !== "string" ? result : result[0].status);
                    }
                    return returnPromise;
                }
                else {
                    sendPush = true;
                    return typeof data.txId !== "string" ? result : (_a = result[0]) === null || _a === void 0 ? void 0 : _a.status;
                }
            }
            async transactionMessage(data, message) {
                if (typeof data !== "object" || data === null || (data.push !== undefined && typeof data.push !== "boolean") ||
                    (data.wait !== undefined && typeof data.wait !== "boolean")) {
                    return Promise.reject("Missing or invalid request data parameters.");
                }
                const ids = data.txId instanceof Array ? data.txId : [data.txId];
                if (ids.length === 0 || ids.some((txId) => typeof txId !== "string" || !validana_core_1.Crypto.isHex(txId))) {
                    return Promise.reject("Missing or invalid request data parameters.");
                }
                const result = [];
                let returnPromise;
                let returnPromiseResolve;
                let sendPush = false;
                if (data.wait === true) {
                    returnPromise = new Promise((resolve) => {
                        returnPromiseResolve = resolve;
                        for (const id of ids) {
                            events_1.ServerEventEmitter.get("transactionId").subscribe(message, (processedTx) => {
                                result.push(this.dbTxToTxResponse(processedTx));
                                if (result.length === ids.length) {
                                    message.latencyStart = undefined;
                                    resolve(typeof data.txId !== "string" ? result : result[0]);
                                }
                            }, id);
                        }
                    });
                }
                else if (data.push === true && message.protocol.canPush()) {
                    for (const id of ids) {
                        events_1.ServerEventEmitter.get("transactionId").subscribe(message, (processedTx) => {
                            const subResult = this.dbTxToTxResponse(processedTx);
                            sendPush ? message.protocol.sendPush(message, basicapi_1.BasicPushTypes.Transaction, subResult) : result.push(subResult);
                        }, id);
                    }
                }
                let foundTxs;
                try {
                    foundTxs = (await database_1.Database.get().query(Basics.getTxs, [ids.map(validana_core_1.Crypto.hexToBinary)])).rows;
                }
                catch (error) {
                    validana_core_1.Log.error("Failed to retrieve transaction", error);
                    return Promise.reject("Unable to retrieve transaction.");
                }
                if (result.length > 0) {
                    foundTxs = foundTxs.filter((foundTx) => result.every((subResult) => subResult.id !== foundTx.transaction_id.toString("hex")));
                }
                for (const foundTx of foundTxs) {
                    const hexId = validana_core_1.Crypto.binaryToHex(foundTx.transaction_id);
                    events_1.ServerEventEmitter.get("transactionId").unsubscribe(message, hexId);
                    result.push(this.dbTxToTxResponse(foundTx));
                }
                if (returnPromise !== undefined) {
                    if (result.length === ids.length) {
                        returnPromiseResolve(typeof data.txId !== "string" ? result : result[0]);
                    }
                    return returnPromise;
                }
                else {
                    sendPush = true;
                    return typeof data.txId !== "string" ? result : result[0];
                }
            }
            async timeMessage() {
                try {
                    const result = (await database_1.Database.get().query(Basics.getLatestBlockTs)).rows[0];
                    if (result === undefined) {
                        return Promise.reject("No existing blocks found.");
                    }
                    else {
                        return result.processed_ts;
                    }
                }
                catch (error) {
                    validana_core_1.Log.error("Unable to retrieve latest block.", error);
                    return Promise.reject("Unable to retrieve latest block.");
                }
            }
            async metricsMessage(data, message) {
                message.log = false;
                if (typeof data !== "object" || data === null || typeof data.format !== "string" || typeof data.token !== "string") {
                    return Promise.reject("Missing or invalid request data parameters.");
                }
                const configToken = config_1.Config.get().VSERVER_METRICSTOKEN;
                if (data.token.length !== configToken.length ||
                    !Encryption.timingSafeEqual(Buffer.from(data.token), Buffer.from(configToken))) {
                    message.statusCode = 401;
                    return Promise.reject("Invalid token.");
                }
                if (!metrics_1.Metrics.syncedOnce) {
                    return Promise.reject("No metrics gathered yet, please try again in a moment.");
                }
                message.latencyStart = undefined;
                try {
                    if (data.format === "json") {
                        return Object.assign({}, ...await metrics_1.Metrics.export("json"));
                    }
                    else if (data.format === "prometheus") {
                        const result = (await metrics_1.Metrics.export("prometheus")).join("\n");
                        message.responseHeaders = { "Content-Type": "text/plain; charset=UTF-8" };
                        return result;
                    }
                    else {
                        return await metrics_1.Metrics.export(data.format);
                    }
                }
                catch (error) {
                    validana_core_1.Log.error("Unable to retrieve metrics.", error);
                    return Promise.reject("Unable to retrieve metrics.");
                }
            }
        },
        _a.getContracts = `SELECT encode(contract_hash, 'hex') AS hash, contract_type AS type, contract_version AS version, `
            + `description, contract_template AS template, validana_version AS "validanaVersion" FROM basics.contracts;`,
        _a.storeTransaction = "INSERT INTO basics.transactions(version, transaction_id, contract_hash, "
            + "valid_till, payload, signature, public_key, create_ts) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);",
        _a.getLatestBlockTs = "SELECT processed_ts FROM basics.blocks ORDER BY block_id DESC LIMIT 1;",
        _a.getTxs = "SELECT * FROM basics.transactions WHERE transaction_id = ANY($1) AND processed_ts IS NOT NULL;",
        _a.getTxsStatus = "SELECT transaction_id, status, message " +
            "FROM basics.transactions WHERE transaction_id = ANY($1) AND processed_ts IS NOT NULL;",
        _a.getTx = "SELECT * FROM basics.transactions WHERE transaction_id = $1;",
        _a.getTxStatus = "SELECT transaction_id, status, message FROM basics.transactions WHERE transaction_id = $1;",
        _a;
}
exports.addBasics = addBasics;
