"use strict";
/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
const Cluster = require("cluster");
const OS = require("os");
const validana_core_1 = require("@coinversable/validana-core");
const http_1 = require("./protocol/http");
const websocket_1 = require("./protocol/websocket");
const database_1 = require("./core/database");
const config_1 = require("./config");
const httpserver_1 = require("./core/httpserver");
const events_1 = require("./core/events");
const metrics_1 = require("./core/metrics");
class ExtendedWorker extends Cluster.Worker {
}
function start(requestHandlers = new Map()) {
    process.on("uncaughtException", async (error) => {
        if (error.stack === undefined) {
            error.stack = "";
        }
        if (config_1.Config.get().VSERVER_DBPASSWORD !== undefined) {
            error.message = error.message.replace(new RegExp(config_1.Config.get().VSERVER_DBPASSWORD, "g"), "");
            error.stack = error.stack.replace(new RegExp(config_1.Config.get().VSERVER_DBPASSWORD, "g"), "");
        }
        await validana_core_1.Log.fatal("uncaughtException", error);
        process.exit(2);
    });
    process.on("unhandledRejection", async (reason, promise) => {
        let error;
        await promise.catch((e) => error = e);
        await validana_core_1.Log.fatal(`unhandledRejection: ${reason}`, error);
        process.exit(2);
    });
    process.on("warning", (warning) => {
        validana_core_1.Log.warn("Process warning", warning);
    });
    const version = [];
    for (const subVersion of process.versions.node.split(".")) {
        version.push(Number.parseInt(subVersion, 10));
    }
    if (version[0] === 10 && version[1] <= 8) {
        throw new Error(`Please upgrade to node js version 10.9, there is a problematic bug in earlier 10.x versions, ` +
            `current version: ${process.versions.node}.`);
    }
    try {
        config_1.Config.get();
        if (config_1.Config.get().VSERVER_SENTRYURL !== undefined) {
            validana_core_1.Log.setReportErrors(config_1.Config.get().VSERVER_SENTRYURL);
        }
    }
    catch (error) {
        validana_core_1.Log.error(`${error.message} Exiting process.`);
        process.exit(1);
    }
    validana_core_1.Log.options.tags.master = Cluster.isMaster.toString();
    validana_core_1.Log.options.tags.nodejsVersion = process.versions.node;
    validana_core_1.Log.options.tags.serverVersion = require("../package.json").version;
    validana_core_1.Log.Level = config_1.Config.get().VSERVER_LOGLEVEL;
    if (config_1.Config.get().VSERVER_LOGFORMAT !== undefined) {
        validana_core_1.Log.LogFormat = config_1.Config.get().VSERVER_LOGFORMAT;
    }
    let isShuttingDown = false;
    let isGraceful = true;
    if (Cluster.isMaster) {
        setupMaster();
    }
    else {
        setupWorker();
    }
    function setupMaster() {
        validana_core_1.Log.info(`Master (pid: ${process.pid}) is running`);
        let workers = config_1.Config.get().VSERVER_WORKERS;
        if (workers <= 0) {
            workers = Math.max(1, OS.cpus().length + workers);
        }
        for (let i = 0; i < workers; i++) {
            createWorker();
        }
        Cluster.on("exit", (worker, code, _) => {
            if (code === 0) {
                validana_core_1.Log.info(`Worker ${worker.id} (pid: ${worker.process.pid}) exited.`);
            }
            else {
                validana_core_1.Log.info(`Worker ${worker.id} (pid: ${worker.process.pid}) died with code ${code}`);
                validana_core_1.Log.error(`Worker died with code ${code}`);
            }
            if (code >= 50 && code < 60) {
                setTimeout(createWorker, 30000);
            }
            else {
                setTimeout(createWorker, 1000);
            }
        });
        Cluster.on("message", (worker, message) => {
            if (typeof message === "object" && message !== null && message.type === "report" && Number.isFinite(message.memory)) {
                worker.notNotifiedTimes = 0;
                if (message.memory > config_1.Config.get().VSERVER_MAXMEMORY && config_1.Config.get().VSERVER_MAXMEMORY !== 0) {
                    validana_core_1.Log.warn(`Worker ${worker.id} using too much memory, restarting worker.`);
                    shutdownWorker(worker.id.toString(), true);
                }
            }
            else {
                validana_core_1.Log.info(`Worker ${worker.id} send an unknown message.`);
                validana_core_1.Log.error("Worker send an unknown message.");
            }
        });
        setInterval(() => {
            for (const id of Object.keys(Cluster.workers)) {
                const worker = Cluster.workers[id];
                if (worker !== undefined) {
                    if (worker.notNotifiedTimes === undefined) {
                        worker.notNotifiedTimes = 0;
                    }
                    else if (worker.notNotifiedTimes === 3) {
                        validana_core_1.Log.info(`Worker ${id} failed to notify for ${3 * worker.notNotifiedTimes} seconds, restarting worker.`);
                        validana_core_1.Log.error("Worker failed to notify multiple times, restarting worker.");
                        shutdownWorker(id, true);
                    }
                    else if (worker.notNotifiedTimes > 0) {
                        validana_core_1.Log.warn(`Worker ${id} failed to notify.`);
                    }
                    worker.notNotifiedTimes++;
                }
            }
        }, 10000);
        process.on("SIGINT", () => {
            validana_core_1.Log.info(`Master (pid: ${process.pid}) received SIGINT`);
            shutdownMaster(false);
        });
        process.on("SIGTERM", () => {
            validana_core_1.Log.info(`Master (pid: ${process.pid}) received SIGTERM`);
            shutdownMaster(true);
        });
    }
    function shutdownMaster(hardkill, code = 0) {
        if (!isShuttingDown) {
            validana_core_1.Log.info(`Master (pid: ${process.pid}) shutting down...`);
            isShuttingDown = true;
            isGraceful = true;
            for (const id of Object.keys(Cluster.workers)) {
                shutdownWorker(id, hardkill);
            }
            setInterval(() => {
                if (Object.keys(Cluster.workers).length === 0) {
                    validana_core_1.Log.info("Shutdown completed");
                    process.exit(code === 0 && !isGraceful ? 1 : code);
                }
            }, 500);
        }
    }
    function setupWorker() {
        Cluster.worker.on("error", (error) => {
            validana_core_1.Log.error("Worker encountered an error", error);
            process.exit(1);
        });
        validana_core_1.Log.info(`Worker ${Cluster.worker.id} (pid: ${process.pid}) started`);
        setInterval(() => {
            const memory = process.memoryUsage();
            Cluster.worker.send({ type: "report", memory: (memory.heapTotal + memory.external) / 1024 / 1024 });
        }, 5000);
        database_1.Database.get().setup({
            database: config_1.Config.get().VSERVER_DBNAME,
            user: config_1.Config.get().VSERVER_DBUSER,
            password: config_1.Config.get().VSERVER_DBPASSWORD,
            host: config_1.Config.get().VSERVER_DBHOST,
            port: config_1.Config.get().VSERVER_DBPORT,
            min: config_1.Config.get().VSERVER_DBMINCONNECTIONS,
            max: config_1.Config.get().VSERVER_DBMAXCONNECTIONS,
            connectionTimeoutMillis: 5000
        });
        listenNewBlocks();
        if (config_1.Config.get().VSERVER_METRICSINTERVAL !== 0) {
            const metricsEventGenerator = new events_1.ServerEventGenerator(metrics_1.Metrics.sync, config_1.Config.get().VSERVER_METRICSINTERVAL * 1000);
            database_1.Database.get().on("destroy", () => metricsEventGenerator.stop());
        }
        const protocols = [];
        let server;
        if (config_1.Config.get().VSERVER_HTTPPORT === config_1.Config.get().VSERVER_WSPORT) {
            server = new httpserver_1.HttpServer(config_1.Config.get().VSERVER_HTTPPORT);
        }
        if (config_1.Config.get().VSERVER_HTTPPORT !== 0) {
            protocols.push(new http_1.HttpProtocol(Cluster.worker, (server !== null && server !== void 0 ? server : config_1.Config.get().VSERVER_HTTPPORT), requestHandlers));
        }
        if (config_1.Config.get().VSERVER_WSPORT !== 0) {
            protocols.push(new websocket_1.WebsocketProtocol(Cluster.worker, (server !== null && server !== void 0 ? server : config_1.Config.get().VSERVER_WSPORT), requestHandlers));
        }
        Cluster.worker.on("message", async (message) => {
            var _a;
            validana_core_1.Log.info(`Worker ${Cluster.worker.id} (pid: ${process.pid}) received message: ${(_a = message) === null || _a === void 0 ? void 0 : _a.type}`);
            if (message.type === "shutdown" && typeof message.graceful === "boolean") {
                if (!isShuttingDown) {
                    isShuttingDown = true;
                    const promises = [];
                    for (const protocol of protocols) {
                        promises.push(protocol.shutdown(true, message.graceful));
                    }
                    promises.push(database_1.Database.shutdownAll());
                    await Promise.all(promises);
                    process.exit(0);
                }
            }
        });
        process.on("SIGTERM", async () => {
            validana_core_1.Log.info(`Worker ${Cluster.worker.id} (pid: ${process.pid}) received SIGTERM`);
            if (!isShuttingDown) {
                isShuttingDown = true;
                const promises = [];
                for (const protocol of protocols) {
                    promises.push(protocol.shutdown(true, false));
                }
                promises.push(database_1.Database.shutdownAll());
                await Promise.all(promises);
                process.exit(0);
            }
        });
        process.on("SIGINT", async () => {
            validana_core_1.Log.info(`Worker ${Cluster.worker.id} (pid: ${process.pid}) received SIGINT`);
            if (!isShuttingDown) {
                isShuttingDown = true;
                const promises = [];
                for (const protocol of protocols) {
                    promises.push(protocol.shutdown(true, true));
                }
                promises.push(database_1.Database.shutdownAll());
                await Promise.all(promises);
                process.exit(0);
            }
        });
    }
    async function listenNewBlocks() {
        const connection = database_1.Database.get().getDedicatedConnection();
        connection.on("end", () => setTimeout(() => listenNewBlocks, 5000));
        connection.on("notification", async (message) => {
            const payload = JSON.parse(message.payload);
            if ((payload.txs !== undefined && payload.txs > 0 || payload.other !== 0) && (events_1.ServerEventEmitter.get("transactionId").hasSubscribers() ||
                events_1.ServerEventEmitter.get("transaction").hasSubscribers() ||
                events_1.ServerEventEmitter.get("transactionContract").hasSubscribers() ||
                events_1.ServerEventEmitter.get("transactionAddress").hasSubscribers())) {
                const result = await database_1.Database.get().query("SELECT * FROM basics.transactions WHERE processed_ts = $1;", [payload.ts]);
                for (const row of result.rows) {
                    events_1.ServerEventEmitter.get("transactionId").emit(row, row.transaction_id.toString("hex"));
                    if (row.sender !== null) {
                        events_1.ServerEventEmitter.get("transactionAddress").emit(row, row.sender);
                    }
                    if (row.receiver !== null) {
                        events_1.ServerEventEmitter.get("transactionAddress").emit(row, row.receiver);
                    }
                    if (row.contract_type !== null) {
                        events_1.ServerEventEmitter.get("transactionContract").emit(row, row.contract_type);
                    }
                    events_1.ServerEventEmitter.get("transaction").emit(row);
                }
            }
        });
        try {
            await connection.connect();
        }
        catch (error) {
        }
        try {
            await connection.query("LISTEN blocks;");
        }
        catch (error) {
            await connection.end().catch(() => { });
        }
    }
    function createWorker(timeout = 5000) {
        if (!isShuttingDown) {
            try {
                Cluster.fork(config_1.Config.get());
            }
            catch (error) {
                validana_core_1.Log.warn("Failed to start worker", error);
                setTimeout(createWorker, timeout, Math.min(timeout * 1.5, 300000));
            }
        }
    }
    function shutdownWorker(id, hardkill) {
        if (Cluster.workers[id] !== undefined) {
            Cluster.workers[id].send({ type: "shutdown", graceful: !hardkill }, undefined, (error) => {
                if (error !== null && error.message !== "write EPIPE") {
                    validana_core_1.Log.warn(`Worker ${id} shutdown failed`, error);
                }
            });
        }
        else {
            validana_core_1.Log.info(`Trying to shutdown non-existing worker ${id}`);
            validana_core_1.Log.error("Trying to shutdown non-existing worker");
        }
        if (hardkill) {
            setTimeout(() => {
                if (Cluster.workers[id] !== undefined) {
                    isGraceful = false;
                    validana_core_1.Log.info(`Worker ${id} not shutting down.`);
                    validana_core_1.Log.fatal("Hard killing worker.");
                    process.kill(Cluster.workers[id].process.pid, "SIGKILL");
                }
            }, 10000);
        }
    }
}
exports.start = start;
