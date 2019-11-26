"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const actionhandler_1 = require("../actionhandler");
const database_1 = require("../database");
const basicapi_1 = require("./basicapi");
const log_1 = require("../tools/log");
const crypto_1 = require("../tools/crypto");
function addBasics(Extend) {
    var _a;
    return _a = class Basics extends Extend {
            constructor(...args) {
                super(...args);
                this.addTerminationHandler(() => database_1.Database.get().removeListener(this));
                this.addUpdateHandler(this.basicUpdate);
                this.addMessageHandler(basicapi_1.BasicRequestTypes.Contracts, this.contractsMessage);
                this.addMessageHandler(basicapi_1.BasicRequestTypes.Process, this.processMessage);
                this.addMessageHandler(basicapi_1.BasicRequestTypes.Time, this.timeMessage);
                this.addMessageHandler(basicapi_1.BasicRequestTypes.Transaction, this.transactionMessage);
                this.addMessageHandler(basicapi_1.BasicRequestTypes.TxStatus, this.txStatusMessage);
            }
            basicUpdate(tx, updateReason) {
                if (updateReason === actionhandler_1.UpdateReason.Id) {
                    const pushData = {
                        blockId: tx.block_id,
                        version: tx.version,
                        validTill: tx.valid_till,
                        positionInBlock: tx.position_in_block,
                        processedTs: tx.processed_ts,
                        sender: tx.sender,
                        receiver: tx.receiver,
                        contractType: tx.contract_type,
                        contractHash: crypto_1.Crypto.binaryToHex(tx.contract_hash),
                        status: tx.status,
                        message: tx.message,
                        id: crypto_1.Crypto.binaryToHex(tx.transaction_id),
                        createTs: tx.create_ts,
                        signature: crypto_1.Crypto.binaryToHex(tx.signature),
                        publicKey: crypto_1.Crypto.binaryToHex(tx.public_key),
                        payload: tx.payload,
                        extra1: tx.extra1,
                        extra2: tx.extra2
                    };
                    this.handler.sendPush(this, basicapi_1.BasicPushTypes.Transaction, pushData);
                }
            }
            processMessage(data) {
                return __awaiter(this, void 0, void 0, function* () {
                    if (typeof data !== "object" || (data.createTs !== undefined && !Number.isSafeInteger(data.createTs))
                        || typeof data.base64tx !== "string" || !crypto_1.Crypto.isBase64(data.base64tx)) {
                        return Promise.reject("Missing or invalid request data parameters.");
                    }
                    const tx = crypto_1.Crypto.base64ToBinary(data.base64tx);
                    if (tx.length < 158 || tx.length > 100158) {
                        return Promise.reject("Invalid transaction format.");
                    }
                    const params = [
                        crypto_1.Crypto.binaryToUInt8(tx.slice(4, 5)),
                        tx.slice(5, 21),
                        tx.slice(21, 53),
                        crypto_1.Crypto.binaryToULong(tx.slice(53, 61)),
                        crypto_1.Crypto.binaryToUtf8(tx.slice(61, -97)),
                        tx.slice(-97, -33),
                        tx.slice(-33),
                        data.createTs
                    ];
                    try {
                        yield database_1.Database.get().query({ text: Basics.storeTransaction, values: params });
                        Promise.resolve();
                    }
                    catch (error) {
                        if (error.message.indexOf("duplicate key") !== -1) {
                            return Promise.reject("Transaction with id already exists.");
                        }
                        else {
                            log_1.Log.warn("Failed to store transaction.", error);
                            return Promise.reject("Invalid format or unable to store transaction.");
                        }
                    }
                });
            }
            contractsMessage() {
                return __awaiter(this, void 0, void 0, function* () {
                    try {
                        const result = yield database_1.Database.get().query({ text: Basics.getContracts });
                        const responseData = [];
                        for (const row of result.rows) {
                            responseData.push({
                                type: row.contract_type,
                                hash: crypto_1.Crypto.binaryToHex(row.contract_hash),
                                version: row.contract_version,
                                description: row.description,
                                template: row.contract_template
                            });
                        }
                        return Promise.resolve(responseData);
                    }
                    catch (error) {
                        log_1.Log.warn("Failed to retrieve contracts", error);
                        return Promise.reject("Failed to retrieve contracts.");
                    }
                });
            }
            txStatusMessage(data) {
                return __awaiter(this, void 0, void 0, function* () {
                    if (typeof data !== "object" || (data.push !== undefined && typeof data.push !== "boolean") ||
                        typeof data.txId !== "string" || !crypto_1.Crypto.isHex(data.txId)) {
                        return Promise.reject("Missing or invalid request data parameters.");
                    }
                    try {
                        const binaryTxId = crypto_1.Crypto.hexToBinary(data.txId);
                        const result = yield database_1.Database.get().query({ text: Basics.getTxStatus, values: [binaryTxId] });
                        let responseData;
                        if (result.rows.length === 0 || result.rows[0].status === actionhandler_1.TransactionStatus.New ||
                            result.rows[0].status === actionhandler_1.TransactionStatus.ProcessingAccepted || result.rows[0].status === actionhandler_1.TransactionStatus.ProcessingRejected) {
                            if (data.push === true) {
                                database_1.Database.get().addListener(this, binaryTxId);
                            }
                        }
                        else {
                            responseData = result.rows[0].status;
                        }
                        return Promise.resolve(responseData);
                    }
                    catch (error) {
                        log_1.Log.warn("Failed to retrieve transaction status", error);
                        return Promise.reject("Unable to retrieve transaction status.");
                    }
                });
            }
            transactionMessage(data) {
                return __awaiter(this, void 0, void 0, function* () {
                    if (typeof data !== "object" || (data.push !== undefined && typeof data.push !== "boolean") ||
                        typeof data.txId !== "string" || !crypto_1.Crypto.isHex(data.txId)) {
                        return Promise.reject("Missing or invalid request data parameters.");
                    }
                    try {
                        const binaryTxId = crypto_1.Crypto.hexToBinary(data.txId);
                        const result = yield database_1.Database.get().query({ text: Basics.getTx, values: [binaryTxId] });
                        let responseData;
                        const dbTransaction = result.rows[0];
                        if (dbTransaction === undefined || dbTransaction.status === actionhandler_1.TransactionStatus.New ||
                            dbTransaction.status === actionhandler_1.TransactionStatus.ProcessingAccepted || dbTransaction.status === actionhandler_1.TransactionStatus.ProcessingRejected) {
                            if (data.push === true) {
                                database_1.Database.get().addListener(this, binaryTxId);
                            }
                        }
                        else {
                            responseData = {
                                blockId: dbTransaction.block_id,
                                version: dbTransaction.version,
                                validTill: dbTransaction.valid_till,
                                positionInBlock: dbTransaction.position_in_block,
                                processedTs: dbTransaction.processed_ts,
                                sender: dbTransaction.sender,
                                receiver: dbTransaction.receiver,
                                contractType: dbTransaction.contract_type,
                                contractHash: crypto_1.Crypto.binaryToHex(dbTransaction.contract_hash),
                                status: dbTransaction.status,
                                message: dbTransaction.message,
                                id: crypto_1.Crypto.binaryToHex(dbTransaction.transaction_id),
                                createTs: dbTransaction.create_ts,
                                signature: crypto_1.Crypto.binaryToHex(dbTransaction.signature),
                                publicKey: crypto_1.Crypto.binaryToHex(dbTransaction.public_key),
                                payload: dbTransaction.payload,
                                extra1: dbTransaction.extra1,
                                extra2: dbTransaction.extra2
                            };
                        }
                        return Promise.resolve(responseData);
                    }
                    catch (error) {
                        log_1.Log.warn("Failed to retrieve transaction", error);
                        return Promise.reject("Unable to retrieve transaction.");
                    }
                });
            }
            timeMessage() {
                return __awaiter(this, void 0, void 0, function* () {
                    try {
                        const result = yield database_1.Database.get().query({ text: Basics.getLatestBlockTs });
                        if (result.rows.length > 0) {
                            return Promise.resolve(result.rows[0].processed_ts);
                        }
                        else {
                            return Promise.reject("No existing blocks found.");
                        }
                    }
                    catch (error) {
                        log_1.Log.warn("Unable to retrieve latest block from database.", error);
                        return Promise.reject("Unable to retrieve latest block from database.");
                    }
                });
            }
        },
        _a.storeTransaction = "INSERT INTO basics.transactions(version, transaction_id, contract_hash, "
            + "valid_till, payload, signature, public_key, create_ts) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);",
        _a.getContracts = "SELECT contract_hash, contract_type, contract_version, description, "
            + "creator, contract_template FROM basics.contracts;",
        _a.getTx = "SELECT * FROM basics.transactions WHERE transaction_id = $1;",
        _a.getTxStatus = "SELECT status FROM basics.transactions WHERE transaction_id = $1;",
        _a.getLatestBlockTs = "SELECT processed_ts FROM basics.blocks ORDER BY block_id DESC LIMIT 1;",
        _a;
}
exports.addBasics = addBasics;
//# sourceMappingURL=addBasics.js.map