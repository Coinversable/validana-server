"use strict";
/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionStatus = exports.Database = void 0;
const validana_core_1 = require("@coinversable/validana-core");
const pg_1 = require("pg");
const events_1 = require("events");
pg_1.types.setTypeParser(20, (val) => Number.parseInt(val, 10));
pg_1.types.setTypeParser(1016, (val) => val.length === 2 ? [] : val.slice(1, -1).split(",").map((v) => Number.parseInt(v, 10)));
class Database extends events_1.EventEmitter {
    constructor(name) {
        super();
        this.dedicatedConnections = [];
        this.name = name;
    }
    static get(name) {
        if (!Database.instance.has(name)) {
            Database.instance.set(name, new Database(name));
        }
        return Database.instance.get(name);
    }
    setup(setup) {
        if (this.dbSetup === undefined) {
            this.dbSetup = setup;
            this.pool = new pg_1.Pool(this.dbSetup).on("error", (error) => {
                if (this.dbSetup.password !== undefined) {
                    error.message = error.message.replace(new RegExp(this.dbSetup.password, "g"), "");
                }
                validana_core_1.Log.warn("Problem with database connection.", error);
            });
        }
        this.emit("setup");
    }
    isSetup() {
        return this.dbSetup !== undefined;
    }
    isActive() {
        return this.pool !== undefined;
    }
    async shutdown() {
        if (this.pool === undefined) {
            return Promise.resolve();
        }
        this.emit("destroy");
        await Promise.all([
            this.pool.end().catch((error) => validana_core_1.Log.warn("Failed to close database connection.", error)),
            ...this.dedicatedConnections.map((connection) => connection.end())
        ]);
        Database.instance.delete(this.name);
    }
    static async shutdownAll() {
        const promises = [];
        for (const db of Database.instance.values()) {
            promises.push(db.shutdown());
        }
        return Promise.all(promises);
    }
    async query(query, values) {
        if (this.pool === undefined) {
            throw new Error("Database must be setup and active before you can query it.");
        }
        return this.pool.query(query, values);
    }
    async notify(type, data) {
        if (this.pool === undefined) {
            throw new Error("Database must be setup and active before you can send notifications.");
        }
        return this.pool.query(`SELECT pg_notify('validana_notification', $1);`, [JSON.stringify({ data, type })]);
    }
    async getConnection() {
        if (this.pool === undefined) {
            return Promise.reject(new Error("Database must be setup and active before you can query it."));
        }
        return await this.pool.connect();
    }
    getDedicatedConnection() {
        if (this.pool === undefined) {
            throw new Error("Database must be setup and active before you can query it.");
        }
        const client = new pg_1.Client(this.dbSetup).on("error", (error) => {
            if (this.dbSetup.password !== undefined) {
                error.message = error.message.replace(new RegExp(this.dbSetup.password, "g"), "");
            }
            validana_core_1.Log.warn("Problem with database connection.", error);
        });
        this.dedicatedConnections.push(client);
        client.on("end", () => this.dedicatedConnections.splice(this.dedicatedConnections.indexOf(client), 1));
        return client;
    }
    static safeName(name) {
        if (typeof name === "string" && name.match(/^[a-zA-Z_]\w+$/) === null) {
            throw new Error(`Name may not contain special characters: ${name}`);
        }
        return name;
    }
    on(event, listener) {
        return super.on(event, listener);
    }
}
exports.Database = Database;
Database.instance = new Map();
var TransactionStatus;
(function (TransactionStatus) {
    TransactionStatus["New"] = "new";
    TransactionStatus["Invalid"] = "invalid";
    TransactionStatus["Accepted"] = "accepted";
    TransactionStatus["Rejected"] = "rejected";
})(TransactionStatus = exports.TransactionStatus || (exports.TransactionStatus = {}));
