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
const actionhandler_1 = require("./actionhandler");
const log_1 = require("./tools/log");
const pg_1 = require("pg");
const config_1 = require("./config");
pg_1.types.setTypeParser(20, (val) => {
    return Number.parseInt(val, 10);
});
class Database {
    constructor() {
        this.isUpdating = false;
        this.failures = 0;
        this.AHToIdentifier = new Map();
        this.identifierToAH = new Map();
    }
    static get() {
        if (this.instance === undefined) {
            this.instance = new Database();
        }
        return this.instance;
    }
    init(worker) {
        this.worker = worker;
        setInterval(() => this.checkForUpdates(), config_1.Config.get().VSERVER_UPDATEINTERVAL * 1000);
        this.checkForUpdates();
    }
    query(queryConfig) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.client === undefined) {
                this.client = new pg_1.Client({
                    user: config_1.Config.get().VSERVER_DBUSER,
                    database: config_1.Config.get().VSERVER_DBNAME,
                    password: config_1.Config.get().VSERVER_DBPASSWORD,
                    port: config_1.Config.get().VSERVER_DBPORT,
                    host: config_1.Config.get().VSERVER_DBHOST
                }).on("error", (error) => {
                    this.client = undefined;
                    error.message = error.message.replace(new RegExp(config_1.Config.get().VSERVER_DBPASSWORD, "g"), "");
                    log_1.Log.warn("Problem with database connection.", error);
                }).on("end", () => this.client = undefined);
                yield this.client.connect();
            }
            return this.client.query(queryConfig);
        });
    }
    addListener(actionHandler, idOrAddress) {
        if (idOrAddress instanceof Buffer) {
            idOrAddress = idOrAddress.toString();
        }
        if (actionHandler === undefined) {
            log_1.Log.error("no action handler", new Error());
        }
        if (!this.AHToIdentifier.has(actionHandler)) {
            this.AHToIdentifier.set(actionHandler, [idOrAddress]);
        }
        else if (this.AHToIdentifier.get(actionHandler).indexOf(idOrAddress) === -1) {
            this.AHToIdentifier.get(actionHandler).push(idOrAddress);
        }
        else {
            return;
        }
        if (!this.identifierToAH.has(idOrAddress)) {
            this.identifierToAH.set(idOrAddress, [actionHandler]);
        }
        else if (this.identifierToAH.get(idOrAddress).indexOf(actionHandler) === -1) {
            this.identifierToAH.get(idOrAddress).push(actionHandler);
        }
    }
    removeListener(actionHandler) {
        const AHMap = this.AHToIdentifier.get(actionHandler);
        if (AHMap !== undefined) {
            for (const identifier of AHMap) {
                const identifierMap = this.identifierToAH.get(identifier);
                identifierMap.splice(identifierMap.indexOf(actionHandler), 1);
                if (identifierMap.length === 0) {
                    this.identifierToAH.delete(identifier);
                }
            }
            this.AHToIdentifier.delete(actionHandler);
        }
    }
    checkForUpdates() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isUpdating) {
                this.failures++;
                log_1.Log.warn(`Backend under heavy load, number of failures: ${this.failures}`);
                return;
            }
            this.isUpdating = true;
            if (this.latestProcessedTs === undefined) {
                try {
                    const result = yield this.query({ text: Database.getLatest });
                    this.latestProcessedTs = result.rows.length === 0 ? -1 : result.rows[0].processed_ts;
                }
                catch (error) {
                    log_1.Log.warn("Failed to retrieve latest transaction", error);
                    this.failures++;
                    this.isUpdating = false;
                    return;
                }
            }
            try {
                const result = yield this.query({ text: Database.getNew, values: [this.latestProcessedTs] });
                for (const row of result.rows) {
                    const notifiedActionHandlers = [];
                    const transactionIdString = row.transaction_id.toString();
                    if (this.identifierToAH.has(transactionIdString)) {
                        for (const ah of this.identifierToAH.get(transactionIdString)) {
                            notifiedActionHandlers.push(ah);
                            ah.receiveUpdate(row, actionhandler_1.UpdateReason.Id);
                            this.AHToIdentifier.get(ah).splice(this.AHToIdentifier.get(ah).indexOf(transactionIdString), 1);
                        }
                        this.identifierToAH.delete(transactionIdString);
                    }
                    if (this.identifierToAH.has(row.sender)) {
                        for (const addressListener of this.identifierToAH.get(row.sender)) {
                            if (notifiedActionHandlers.indexOf(addressListener) === -1) {
                                notifiedActionHandlers.push(addressListener);
                                addressListener.receiveUpdate(row, actionhandler_1.UpdateReason.Address);
                            }
                        }
                    }
                    if (this.identifierToAH.has(row.receiver)) {
                        for (const addressListener of this.identifierToAH.get(row.receiver)) {
                            if (notifiedActionHandlers.indexOf(addressListener) === -1) {
                                notifiedActionHandlers.push(addressListener);
                                addressListener.receiveUpdate(row, actionhandler_1.UpdateReason.Address);
                            }
                        }
                    }
                    if (this.identifierToAH.has(undefined)) {
                        for (const addressListener of this.identifierToAH.get(undefined)) {
                            if (notifiedActionHandlers.indexOf(addressListener) === -1) {
                                notifiedActionHandlers.push(addressListener);
                                addressListener.receiveUpdate(row, actionhandler_1.UpdateReason.Global);
                            }
                        }
                    }
                    if (row.processed_ts > this.latestProcessedTs) {
                        this.latestProcessedTs = row.processed_ts;
                    }
                }
                this.failures = 0;
                this.isUpdating = false;
                this.worker.send({ type: "report", memory: process.memoryUsage().heapTotal / 1024 / 1024 });
            }
            catch (error) {
                log_1.Log.warn("Failed to retrieve new transactions", error);
                this.failures++;
                this.isUpdating = false;
            }
        });
    }
}
exports.Database = Database;
Database.getLatest = "SELECT processed_ts, block_id FROM basics.transactions ORDER BY processed_ts DESC NULLS LAST LIMIT 1;";
Database.getNew = "SELECT * FROM basics.transactions WHERE processed_ts > $1;";
//# sourceMappingURL=database.js.map