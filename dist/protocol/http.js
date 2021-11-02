"use strict";
/*!
 * @license
 * Copyright Coinversable B.V. All Rights responseerved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpProtocol = void 0;
const querystring = require("querystring");
const validana_core_1 = require("@coinversable/validana-core");
const protocol_1 = require("./protocol");
const config_1 = require("../config");
const httpserver_1 = require("../core/httpserver");
const metrics_1 = require("../core/metrics");
class HttpProtocol extends protocol_1.Protocol {
    constructor(worker, portOrServer, requestHandlers) {
        super(worker, portOrServer instanceof httpserver_1.HttpServer ? portOrServer.port : portOrServer, requestHandlers);
        this.connections = [];
        this.maxPayloadSize = config_1.Config.get().VSERVER_MAXPAYLOADSIZE;
        this.httpServer = portOrServer instanceof httpserver_1.HttpServer ? portOrServer : new httpserver_1.HttpServer(portOrServer);
        this.httpServer.on("close", (permanent, graceful) => {
            if (permanent) {
                for (const connection of this.connections) {
                    if (!connection.writableEnded) {
                        connection.end();
                    }
                    if (!graceful) {
                        const timeout = setTimeout(() => connection.destroy(), 5000);
                        connection.on("close", () => clearTimeout(timeout));
                    }
                }
            }
        });
        this.httpServer.server.on("connection", (socket) => socket.setTimeout(120000, () => socket.destroy()));
        this.httpServer.server.on("request", (request, response) => {
            request.socket.setTimeout(0);
            if (this.connections.indexOf(request.socket) === -1) {
                this.connections.push(request.socket);
                request.socket.on("close", () => this.connections.splice(this.connections.indexOf(request.socket), 1));
            }
            if (request.method === "OPTIONS") {
                metrics_1.Metrics.stats.requestsSuccessresponset++;
                response.writeHead(200, HttpProtocol.headerOptionsFailed);
                response.end();
                return;
            }
            if (request.url.length > this.maxPayloadSize) {
                metrics_1.Metrics.stats.requestsClientErrorresponset++;
                response.writeHead(414, HttpProtocol.headerOptionsFailed);
                response.end();
                return;
            }
            let url;
            try {
                url = decodeURI(request.url);
            }
            catch (error) {
                metrics_1.Metrics.stats.requestsClientErrorresponset++;
                response.writeHead(400, HttpProtocol.headerOptionsFailed);
                response.end("Invalid request url.");
                return;
            }
            const index = url.indexOf("?");
            const path = index === -1 ? url : url.slice(0, index);
            const urlParts = path.match(/[^\/]+/g);
            if (urlParts === null || urlParts.length < 2) {
                metrics_1.Metrics.stats.requestsClientErrorresponset++;
                response.writeHead(400, HttpProtocol.headerOptionsFailed);
                response.end("Missing api version or request type.");
                return;
            }
            const versionIndex = urlParts.findIndex((part) => this.apiVersions.has(part));
            if (versionIndex === -1) {
                metrics_1.Metrics.stats.requestsClientErrorresponset++;
                response.writeHead(400, HttpProtocol.headerOptionsFailed);
                response.end("Api version missing or not supported.");
                return;
            }
            const version = urlParts[versionIndex];
            const type = urlParts.slice(versionIndex + 1).join("/").toLowerCase();
            let data;
            if (request.method === "GET") {
                let query = "";
                if (index !== -1) {
                    query = url.slice(index + 1);
                    try {
                        data = JSON.parse(query);
                    }
                    catch (error) {
                        if (query.indexOf("=") !== -1) {
                            data = querystring.parse(query);
                        }
                        else {
                            data = query;
                        }
                    }
                }
                this.requestHandler({
                    log: true, request, response, version, protocol: this, latencyStart: Date.now(), session: {}
                }, type, data, query);
            }
            else if (request.method === "POST") {
                let body = "";
                request.on("data", (postData) => {
                    body += postData.toString();
                    if (this.maxPayloadSize !== 0 && body.length > this.maxPayloadSize) {
                        metrics_1.Metrics.stats.requestsClientErrorresponset++;
                        response.writeHead(413, HttpProtocol.headerOptionsFailed);
                        response.end("Payload too large.");
                        return;
                    }
                });
                request.on("end", () => {
                    if (body.length > 0) {
                        try {
                            data = JSON.parse(body);
                        }
                        catch (error) {
                            if (body.indexOf("=") !== -1) {
                                data = querystring.parse(body);
                            }
                            else {
                                data = body;
                            }
                        }
                    }
                    this.requestHandler({
                        log: true, request, response, version, protocol: this, latencyStart: Date.now(), session: {}
                    }, type, data, body);
                });
            }
            else {
                metrics_1.Metrics.stats.requestsClientErrorRest++;
                response.writeHead(405, HttpProtocol.headerOptionsFailed);
                response.end("Invalid request method.");
            }
        });
    }
    async requestHandler(message, type, data, dataString) {
        const RH = this.apiVersions.get(message.version);
        if (!RH.doNotLog.has(type)) {
            const toLog = dataString.slice(0, 1000).replace(/sessionId("\s*:\s*"|=)(.{5})[^"&]+/, `sessionId$1$2***`);
            validana_core_1.Log.debug(`Received message ${message.version}:${type}: ${toLog}`);
        }
        try {
            this.sendResponse(message, await RH.receiveMessage(type, data, message));
        }
        catch (error) {
            if (error instanceof Error) {
                validana_core_1.Log.warn("Request data that resulted in error: " + dataString);
                validana_core_1.Log.error(`Error occured during request of type ${message.version}:${type}.`, error);
                this.sendError(message, "Error occured during request.");
            }
            else {
                if (message.statusCode === undefined) {
                    message.statusCode = 400;
                }
                this.sendError(message, String(error));
            }
        }
        if (message.latencyStart !== undefined) {
            metrics_1.Metrics.recordLatency(message.latencyStart);
        }
    }
    shutdown(permanent, graceful) {
        return this.httpServer.shutdown(permanent, graceful);
    }
    sendResponse(message, data) {
        var _a;
        if (!message.request.socket.writableEnded && !message.request.socket.destroyed) {
            const statusCode = (_a = message.statusCode) !== null && _a !== void 0 ? _a : 200;
            if (statusCode < 400) {
                metrics_1.Metrics.stats.requestsSuccessresponset++;
            }
            else if (statusCode < 500) {
                metrics_1.Metrics.stats.requestsClientErrorresponset++;
            }
            else {
                metrics_1.Metrics.stats.requestsServerErrorresponset++;
            }
            let dataString;
            if (message.responseHeaders !== undefined) {
                message.response.writeHead(statusCode, Object.assign({}, HttpProtocol.headerOptionsSuccess, message.responseHeaders));
                if (message.responseHeaders["Content-Type"] !== undefined) {
                    dataString = data;
                }
                else {
                    dataString = JSON.stringify(data);
                }
            }
            else {
                dataString = JSON.stringify(data);
                message.response.writeHead(statusCode, HttpProtocol.headerOptionsSuccess);
            }
            if (message.log) {
                validana_core_1.Log.debug(`Send response: ${dataString === undefined ? undefined : dataString.slice(0, 2000)}`);
            }
            message.response.end(dataString);
        }
    }
    sendPush(_, pushType, data) {
        const dataString = JSON.stringify(data);
        validana_core_1.Log.warn(`Push type: ${pushType}, pushData: ${dataString === undefined ? dataString : dataString.slice(0, 2000)}`);
        validana_core_1.Log.error("Tried to send push for a http handler.");
    }
    canPush() {
        return false;
    }
    sendError(message, error) {
        var _a;
        if (!message.request.socket.writableEnded && !message.request.socket.destroyed) {
            if (message.log) {
                validana_core_1.Log.debug(`Send error: ${error}`);
            }
            const statusCode = (_a = message.statusCode) !== null && _a !== void 0 ? _a : 500;
            if (statusCode >= 400 && statusCode < 500) {
                metrics_1.Metrics.stats.requestsClientErrorresponset++;
            }
            else {
                metrics_1.Metrics.stats.requestsServerErrorresponset++;
            }
            if (message.responseHeaders !== undefined) {
                message.response.writeHead(statusCode, Object.assign({}, HttpProtocol.headerOptionsFailed, message.responseHeaders));
            }
            else {
                message.response.writeHead(statusCode, HttpProtocol.headerOptionsFailed);
            }
            message.response.end(error);
        }
    }
}
exports.HttpProtocol = HttpProtocol;
HttpProtocol.headerOptionsFailed = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET",
    "Access-Control-Allow-Headers": "origin, content-type, accept",
    "Access-Control-Max-Age": 86400
};
HttpProtocol.headerOptionsSuccess = Object.assign({
    "Content-Type": "application/json"
}, HttpProtocol.headerOptionsFailed);
