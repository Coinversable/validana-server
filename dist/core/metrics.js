"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Metrics = void 0;
const config_1 = require("../config");
const database_1 = require("./database");
const OS = require("os");
const Cluster = require("cluster");
class Metrics {
    static addTotalMetrics(names, exporters) {
        for (const name of names) {
            Metrics.stats[name] = 0;
        }
        Metrics.totalNames.push(...names);
        for (const key of Object.keys(exporters)) {
            if (Metrics.totalExporters.has(key)) {
                Metrics.totalExporters.get(key).push(exporters[key]);
            }
            else {
                Metrics.totalExporters.set(key, [exporters[key]]);
            }
        }
    }
    static addCurrentMetrics(names, exporters) {
        for (const name of names) {
            Metrics.stats[name] = 0;
        }
        Metrics.currentNames.push(...names);
        for (const key of Object.keys(exporters)) {
            if (Metrics.currentExporters.has(key)) {
                Metrics.currentExporters.get(key).push(exporters[key]);
            }
            else {
                Metrics.currentExporters.set(key, [exporters[key]]);
            }
        }
    }
    static async export(format, includeDefaults = true) {
        if (config_1.Config.get().VSERVER_METRICSINTERVAL === 0) {
            throw new Error("Gathering metrics is disabled, unable to export.");
        }
        if (!Metrics.syncedOnce) {
            throw new Error("No metrics gathered yet, please try again in a moment.");
        }
        const [currentMetrics, totalMetrics] = await Promise.all([
            Metrics.database.query("SELECT metric, jsonb_agg(value) AS value FROM basics.metrics WHERE worker != -1 GROUP BY metric;", []),
            Metrics.database.query("SELECT metric, value FROM basics.metrics WHERE worker = -1;", [])
        ]);
        const allMetrics = {};
        for (const row of currentMetrics.rows) {
            allMetrics[row.metric] = row.value;
        }
        for (const row of totalMetrics.rows) {
            allMetrics[row.metric] = row.value;
        }
        const result = [];
        if (includeDefaults) {
            if (format === "json") {
                result.push(Metrics.exportJson(allMetrics));
            }
            else if (format === "prometheus") {
                result.push(Metrics.exportPrometheus(allMetrics));
            }
        }
        if (Metrics.currentExporters.has(format)) {
            for (const exporter of Metrics.currentExporters.get(format)) {
                result.push(exporter(allMetrics));
            }
        }
        if (Metrics.totalExporters.has(format)) {
            for (const exporter of Metrics.totalExporters.get(format)) {
                result.push(exporter(allMetrics));
            }
        }
        return result;
    }
    static sum(input) {
        return input.reduce((sum, element) => sum + element, 0);
    }
    static avg(input) {
        return input.reduce((sum, element) => sum + element, 0) / input.length;
    }
    static exportPrometheus(input) {
        const latencyBucket8 = input.latency8;
        const latencyBucket16 = input.latency16 + latencyBucket8;
        const latencyBucket32 = input.latency32 + latencyBucket16;
        const latencyBucket64 = input.latency64 + latencyBucket32;
        const latencyBucket128 = input.latency128 + latencyBucket64;
        const latencyBucket256 = input.latency256 + latencyBucket128;
        const latencyBucket512 = input.latency512 + latencyBucket256;
        const latencyBucket1024 = input.latency1024 + latencyBucket512;
        const latencyBucket2048 = input.latency2048 + latencyBucket1024;
        const latencyBucket4096 = input.latency4096 + latencyBucket2048;
        const latencyBucketInf = input.latencyInf + latencyBucket4096;
        const websocketBucket10 = input.websocket10;
        const websocketBucket30 = input.websocket30 + websocketBucket10;
        const websocketBucket60 = input.websocket60 + websocketBucket30;
        const websocketBucket120 = input.websocket120 + websocketBucket60;
        const websocketBucket300 = input.websocket300 + websocketBucket120;
        const websocketBucket900 = input.websocket900 + websocketBucket300;
        const websocketBucketInf = input.websocketInf + websocketBucket900;
        const latestUpdate = Math.max(...input.lastSync);
        const workers = config_1.Config.get().VSERVER_WORKERS > 0 ? config_1.Config.get().VSERVER_WORKERS :
            Math.max(Metrics.cpus + config_1.Config.get().VSERVER_WORKERS, 1);
        return `# HELP validana_workers The number of processes that should be running.\n` +
            `# TYPE validana_workers gauge\n` +
            `validana_workers ${workers} ${latestUpdate}\n` +
            `# HELP validana_memory_workers The memory that the workers use.\n` +
            `# TYPE validana_memory_workers gauge\n` +
            `validana_memory_workers ${Metrics.sum(input.memory)} ${latestUpdate}\n` +
            `# HELP validana_memory_total The memory usage including the master process and v8 engine.\n` +
            `# TYPE validana_memory_total gauge\n` +
            `validana_memory_total ${process.memoryUsage().rss} ${Date.now()}\n` +
            `# HELP validana_websocket_connections The number of active websocket connections.\n` +
            `# TYPE validana_websocket_connections gauge\n` +
            `validana_websocket_connections ${Metrics.sum(input.wsConnections)} ${latestUpdate}\n` +
            `# HELP validana_requests The number of requests to the server.\n` +
            `# TYPE validana_requests counter\n` +
            `validana_requests{result="success",type="ws"} ${input.requestsSuccessWs} ${latestUpdate}\n` +
            `validana_requests{result="clientError",type="ws"} ${input.requestsClientErrorWs} ${latestUpdate}\n` +
            `validana_requests{result="serverError",type="ws"} ${input.requestsServerErrorWs} ${latestUpdate}\n` +
            `validana_requests{result="success",type="rest"} ${input.requestsSuccessRest} ${latestUpdate}\n` +
            `validana_requests{result="clientError",type="rest"} ${input.requestsClientErrorRest} ${latestUpdate}\n` +
            `validana_requests{result="serverError",type="rest"} ${input.requestsServerErrorRest} ${latestUpdate}\n` +
            `# HELP validana_latency The latency of requests.\n` +
            `# TYPE validana_latency histogram\n` +
            `validana_latency_bucket{le="0.008"} ${latencyBucket8} ${latestUpdate}\n` +
            `validana_latency_bucket{le="0.016"} ${latencyBucket16} ${latestUpdate}\n` +
            `validana_latency_bucket{le="0.032"} ${latencyBucket32} ${latestUpdate}\n` +
            `validana_latency_bucket{le="0.064"} ${latencyBucket64} ${latestUpdate}\n` +
            `validana_latency_bucket{le="0.128"} ${latencyBucket128} ${latestUpdate}\n` +
            `validana_latency_bucket{le="0.256"} ${latencyBucket256} ${latestUpdate}\n` +
            `validana_latency_bucket{le="0.512"} ${latencyBucket512} ${latestUpdate}\n` +
            `validana_latency_bucket{le="1.024"} ${latencyBucket1024} ${latestUpdate}\n` +
            `validana_latency_bucket{le="2.048"} ${latencyBucket2048} ${latestUpdate}\n` +
            `validana_latency_bucket{le="4.096"} ${latencyBucket4096} ${latestUpdate}\n` +
            `validana_latency_bucket{le="+Inf"} ${latencyBucketInf} ${latestUpdate}\n` +
            `validana_latency_sum ${input.latencyTotal} ${latestUpdate}\n` +
            `validana_latency_count ${latencyBucketInf} ${latestUpdate}\n` +
            `# HELP validana_websocket_duration The duration of websocket connections.\n` +
            `# TYPE validana_websocket_duration histogram\n` +
            `validana_websocket_duration_bucket{le="10"} ${websocketBucket10} ${latestUpdate}\n` +
            `validana_websocket_duration_bucket{le="30"} ${websocketBucket30} ${latestUpdate}\n` +
            `validana_websocket_duration_bucket{le="60"} ${websocketBucket60} ${latestUpdate}\n` +
            `validana_websocket_duration_bucket{le="120"} ${websocketBucket120} ${latestUpdate}\n` +
            `validana_websocket_duration_bucket{le="300"} ${websocketBucket300} ${latestUpdate}\n` +
            `validana_websocket_duration_bucket{le="900"} ${websocketBucket900} ${latestUpdate}\n` +
            `validana_websocket_duration_bucket{le="+Inf"} ${websocketBucketInf} ${latestUpdate}\n` +
            `validana_websocket_duration_sum ${input.websocketTotal} ${latestUpdate}\n` +
            `validana_websocket_duration_count ${websocketBucketInf} ${latestUpdate}`;
    }
    static exportJson(input) {
        const configWorkers = config_1.Config.get().VSERVER_WORKERS;
        return {
            latestUpdate: Math.max(...input.lastSync),
            workers: configWorkers > 0 ? configWorkers : Math.max(Metrics.cpus + configWorkers, 1),
            memory: {
                workers: Metrics.sum(input.memory),
                total: process.memoryUsage().rss
            },
            requests: {
                successWs: input.requestsSuccessWs,
                clientErrorWs: input.requestsClientErrorWs,
                serverErrorWs: input.requestsServerErrorWs,
                successRest: input.requestsSuccessRest,
                clientErrorRest: input.requestsClientErrorRest,
                serverErrorRest: input.requestsServerErrorRest
            },
            latency: {
                8: input.latency8,
                16: input.latency16,
                32: input.latency32,
                64: input.latency64,
                128: input.latency128,
                256: input.latency256,
                512: input.latency512,
                1024: input.latency1024,
                2048: input.latency2048,
                4096: input.latency4096,
                infinity: input.latencyInf,
                total: input.latencyTotal
            },
            currentWsConnections: Metrics.sum(input.wsConnections),
            websocketDuration: {
                10: input.websocket10,
                30: input.websocket30,
                60: input.websocket60,
                120: input.websocket120,
                300: input.websocket300,
                900: input.websocket900,
                infinity: input.websocketInf,
                total: input.websocketTotal
            }
        };
    }
    static async sync() {
        const totalNames = [];
        const totalsValues = [];
        for (const key of Metrics.totalNames) {
            const value = Metrics.stats[key];
            if (value !== 0 || !Metrics.syncedOnce) {
                totalNames.push(key);
                totalsValues.push(value);
                Metrics.stats[key] = 0;
            }
        }
        const memory = process.memoryUsage();
        Metrics.stats.memory = memory.heapTotal + memory.external;
        Metrics.stats.lastSync = Date.now();
        const currentValues = [];
        for (const key of Metrics.currentNames) {
            currentValues.push(Metrics.stats[key]);
        }
        const client = await Metrics.database.getConnection();
        try {
            await client.query("BEGIN;");
            await client.query("INSERT INTO basics.metrics (metric, value) VALUES (unnest($1::TEXT[]), unnest($2::BIGINT[])) " +
                "ON CONFLICT ON CONSTRAINT metrics_pkey DO UPDATE SET value = metrics.value + EXCLUDED.value;", [totalNames, totalsValues]);
            await client.query("INSERT INTO basics.metrics (metric, worker, value) VALUES (unnest($1::TEXT[]), $2, unnest($3::BIGINT[])) " +
                "ON CONFLICT ON CONSTRAINT metrics_pkey DO UPDATE SET value = EXCLUDED.value;", [Metrics.currentNames, Cluster.worker.id, currentValues]);
            if (!Metrics.syncedOnce) {
                Metrics.syncedOnce = true;
                await client.query("DELETE FROM basics.metrics WHERE metric = ANY($1) AND worker != -1 AND worker != $2;", [[...Metrics.totalNames, ...Metrics.currentNames], Cluster.worker.id]);
            }
            await client.query("COMMIT;");
        }
        catch (error) {
            await client.query("ROLLBACK;");
            throw error;
        }
        finally {
            client.release();
        }
    }
    static setDatabase(database = database_1.Database.get()) {
        Metrics.database = database;
    }
    static recordLatency(startTime) {
        const latency = Date.now() - startTime;
        if (latency <= 8) {
            Metrics.stats.latency8++;
        }
        else if (latency <= 16) {
            Metrics.stats.latency16++;
        }
        else if (latency <= 32) {
            Metrics.stats.latency32++;
        }
        else if (latency <= 64) {
            Metrics.stats.latency64++;
        }
        else if (latency <= 128) {
            Metrics.stats.latency128++;
        }
        else if (latency <= 256) {
            Metrics.stats.latency256++;
        }
        else if (latency <= 512) {
            Metrics.stats.latency512++;
        }
        else if (latency <= 1024) {
            Metrics.stats.latency1024++;
        }
        else if (latency <= 2048) {
            Metrics.stats.latency2048++;
        }
        else if (latency <= 4096) {
            Metrics.stats.latency4096++;
        }
        else {
            Metrics.stats.latencyInf++;
        }
        Metrics.stats.latencyTotal += latency;
    }
    static recordDuration(startTime) {
        Metrics.stats.wsConnections--;
        const websocketDuration = Date.now() - startTime;
        Metrics.stats.websocketTotal += websocketDuration;
        if (websocketDuration <= 10000) {
            Metrics.stats.websocket10++;
        }
        else if (websocketDuration <= 30000) {
            Metrics.stats.websocket30++;
        }
        else if (websocketDuration <= 60000) {
            Metrics.stats.websocket60++;
        }
        else if (websocketDuration <= 120000) {
            Metrics.stats.websocket120++;
        }
        else if (websocketDuration <= 300000) {
            Metrics.stats.websocket300++;
        }
        else if (websocketDuration <= 900000) {
            Metrics.stats.websocket900++;
        }
        else {
            Metrics.stats.websocketInf++;
        }
    }
}
exports.Metrics = Metrics;
Metrics.database = database_1.Database.get();
Metrics.cpus = OS.cpus().length;
Metrics.syncedOnce = false;
Metrics.totalStats = {
    requestsSuccessWs: 0,
    requestsClientErrorWs: 0,
    requestsServerErrorWs: 0,
    requestsSuccessRest: 0,
    requestsClientErrorRest: 0,
    requestsServerErrorRest: 0,
    latency8: 0,
    latency16: 0,
    latency32: 0,
    latency64: 0,
    latency128: 0,
    latency256: 0,
    latency512: 0,
    latency1024: 0,
    latency2048: 0,
    latency4096: 0,
    latencyInf: 0,
    latencyTotal: 0,
    websocket10: 0,
    websocket30: 0,
    websocket60: 0,
    websocket120: 0,
    websocket300: 0,
    websocket900: 0,
    websocketInf: 0,
    websocketTotal: 0
};
Metrics.totalNames = Object.keys(Metrics.totalStats);
Metrics.totalExporters = new Map();
Metrics.currentStats = {
    lastSync: 0,
    wsConnections: 0,
    memory: 0
};
Metrics.currentNames = Object.keys(Metrics.currentStats);
Metrics.currentExporters = new Map();
Metrics.stats = Object.assign({}, Metrics.totalStats, Metrics.currentStats);
