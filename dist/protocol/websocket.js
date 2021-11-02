"use strict";
/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsocketProtocol = void 0;
const WebSocket = require("ws");
const validana_core_1 = require("@coinversable/validana-core");
const config_1 = require("../config");
const protocol_1 = require("./protocol");
const httpserver_1 = require("../core/httpserver");
const metrics_1 = require("../core/metrics");
class ExtendedWebSocket extends WebSocket {
    constructor() {
        super(...arguments);
        this.isAlive = false;
    }
}
class WebsocketProtocol extends protocol_1.Protocol {
    constructor(worker, portOrServer, requestHandlers) {
        super(worker, portOrServer instanceof httpserver_1.HttpServer ? portOrServer.port : portOrServer, requestHandlers);
        this.connections = [];
        this.httpServer = portOrServer instanceof httpserver_1.HttpServer ? portOrServer : new httpserver_1.HttpServer(portOrServer);
        this.httpServer.on("close", (permanent, graceful) => {
            if (permanent) {
                for (const connection of this.connections) {
                    if (connection.readyState !== WebSocket.CLOSING && connection.readyState !== WebSocket.CLOSED) {
                        connection.close(1001, "Server shutting down/restarting.");
                    }
                    if (!graceful) {
                        const timeout = setTimeout(() => connection.terminate(), 5000);
                        connection.on("close", () => clearTimeout(timeout));
                    }
                }
            }
        });
        this.timeout = config_1.Config.get().VSERVER_TIMEOUT;
        this.serverOptions = {
            maxPayload: config_1.Config.get().VSERVER_MAXPAYLOADSIZE === 0 ? undefined : config_1.Config.get().VSERVER_MAXPAYLOADSIZE,
            server: this.httpServer.server
        };
        this.wsServer = new WebSocket.Server(this.serverOptions);
        let currentTimer = this.timeout;
        let clientsToCheck = [];
        const interval = setInterval(() => {
            if (this.httpServer.server.listening) {
                currentTimer--;
                if (currentTimer === 0) {
                    clientsToCheck = Array.from(this.wsServer.clients);
                    currentTimer = this.timeout;
                }
                const clientsToCheckThisTime = Math.ceil(1 / currentTimer * clientsToCheck.length);
                for (let i = 0; i < clientsToCheckThisTime; i++) {
                    const client = clientsToCheck.pop();
                    if (client.readyState === WebSocket.OPEN) {
                        if (!client.isAlive) {
                            client.close(1001, "No longer responding to keep alive.");
                            continue;
                        }
                        client.isAlive = false;
                        client.ping();
                    }
                }
            }
            else {
                clearInterval(interval);
            }
        }, 1000);
        this.wsServer.on("connection", (client, request) => {
            request.socket.setTimeout(0);
            this.connections.push(client);
            client.on("close", () => {
                if (client.startTime !== undefined) {
                    metrics_1.Metrics.recordDuration(client.startTime);
                }
                this.connections.splice(this.connections.indexOf(client), 1);
            });
            const session = {};
            validana_core_1.Log.debug(`Worker ${this.worker.id} received an incoming connection.`);
            if (request.url === undefined) {
                metrics_1.Metrics.stats.requestsClientErrorWs++;
                client.close(4100, "Invalid way of connecting.");
                return;
            }
            let urlParts;
            try {
                urlParts = decodeURI(request.url).toLowerCase().match(/[^\/]+/g);
            }
            catch (error) {
                metrics_1.Metrics.stats.requestsClientErrorWs++;
                client.close(4100, "Invalid url.");
                return;
            }
            if (urlParts === null || urlParts.length === 0) {
                metrics_1.Metrics.stats.requestsClientErrorWs++;
                client.close(4100, "Missing api version or request type.");
                return;
            }
            const version = urlParts.find((part) => this.apiVersions.has(part));
            if (version === undefined) {
                metrics_1.Metrics.stats.requestsClientErrorWs++;
                client.close(4100, "Version of the api is not supported.");
                return;
            }
            const RH = this.apiVersions.get(version);
            client.isAlive = true;
            client.startTime = Date.now();
            metrics_1.Metrics.stats.wsConnections++;
            client.on("error", (error) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.close(1006, "Websocket error");
                }
                if (error.message !== "read ECONNRESET") {
                    validana_core_1.Log.warn("Websocket error", error);
                }
            });
            client.on("pong", () => {
                client.isAlive = true;
            });
            client.on("message", async (requestData) => {
                const message = {
                    log: true, protocol: this, request, version, latencyStart: Date.now(), response: client, session
                };
                const requestString = requestData instanceof Array ?
                    requestData.map((part) => part.toString()).join("") : requestData.toString();
                let requestMessage;
                try {
                    requestMessage = JSON.parse(requestString);
                }
                catch (error) {
                    message.statusCode = 400;
                    return this.sendError(message, "Invalid JSON");
                }
                if (typeof requestMessage.id !== "string") {
                    message.statusCode = 400;
                    return this.sendError(message, "Request is missing or has an invalid an ID field");
                }
                message.id = requestMessage.id;
                if (typeof requestMessage.type !== "string") {
                    message.statusCode = 400;
                    return this.sendError(message, "Request is missing or has an invalid request type");
                }
                const type = requestMessage.type.toLowerCase();
                if (!RH.doNotLog.has(type)) {
                    const toLog = requestString.slice(0, 1000).replace(/sessionId"\s*:\s*"(.{5})[^"]+/, `sessionId":"$1***`);
                    validana_core_1.Log.debug(`Received message ${version}:${type}: ${toLog}`);
                }
                try {
                    this.sendResponse(message, await RH.receiveMessage(type, requestMessage.data, message));
                }
                catch (error) {
                    if (error instanceof Error) {
                        validana_core_1.Log.warn("Request data that resulted in error: " + requestString);
                        validana_core_1.Log.error(`Error occured during request of type ${version}: ${type}.`, error);
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
            });
        });
    }
    shutdown(permanent, graceful) {
        return this.httpServer.shutdown(permanent, graceful);
    }
    sendResponse(message, data) {
        var _a;
        if (message.response.readyState === WebSocket.OPEN) {
            const statusCode = (_a = message.statusCode) !== null && _a !== void 0 ? _a : 200;
            if (statusCode < 400) {
                metrics_1.Metrics.stats.requestsSuccessWs++;
            }
            else if (statusCode < 500) {
                metrics_1.Metrics.stats.requestsClientErrorWs++;
            }
            else {
                metrics_1.Metrics.stats.requestsServerErrorWs++;
            }
            const responseString = JSON.stringify({
                id: message.id,
                status: statusCode,
                data
            });
            if (message.log) {
                validana_core_1.Log.debug(`Send response: ${responseString.slice(0, 2000)}`);
            }
            message.response.send(responseString);
        }
        else {
            validana_core_1.Log.warn(`Cannot send message, client state: ${message.response.readyState}`);
        }
    }
    sendPush(message, pushType, data) {
        var _a;
        if (message.response.readyState === WebSocket.OPEN) {
            const pushString = JSON.stringify({
                pushType,
                data,
                status: (_a = message.statusCode) !== null && _a !== void 0 ? _a : 200
            });
            if (message.log) {
                validana_core_1.Log.debug(`Send push: ${pushString === null || pushString === void 0 ? void 0 : pushString.slice(0, 2000)} `);
            }
            message.response.send(pushString);
        }
        else {
            validana_core_1.Log.warn(`Cannot send message, client state: ${message.response.readyState}`);
        }
    }
    canPush() {
        return true;
    }
    sendError(message, error) {
        var _a;
        if (message.response.readyState === WebSocket.OPEN) {
            const statusCode = (_a = message.statusCode) !== null && _a !== void 0 ? _a : 500;
            if (statusCode >= 400 && statusCode < 500) {
                metrics_1.Metrics.stats.requestsClientErrorWs++;
            }
            else {
                metrics_1.Metrics.stats.requestsServerErrorWs++;
            }
            const errorResponse = {
                error,
                status: statusCode,
                id: message.id
            };
            if (message.log) {
                validana_core_1.Log.debug(`Send error(${message.id}): ${error} `);
            }
            message.response.send(JSON.stringify(errorResponse));
        }
        else {
            validana_core_1.Log.warn(`Cannot send message, client state: ${message.response.readyState}`);
        }
    }
}
exports.WebsocketProtocol = WebsocketProtocol;
