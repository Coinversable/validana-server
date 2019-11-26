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
const WebSocket = require("ws");
const http = require("http");
const https = require("https");
const FS = require("fs");
const log_1 = require("../tools/log");
const config_1 = require("../config");
const handler_1 = require("./handler");
class ExtendedWebSocket extends WebSocket {
    constructor() {
        super(...arguments);
        this.isAlive = false;
    }
}
class WebsocketHandler extends handler_1.Handler {
    constructor(worker, port) {
        super(worker, port);
        this.isClosingServer = false;
        this.serverListening = false;
        this.permanentlyClosed = false;
        this.watchingCert = false;
        this.restartTimeout = 5000;
        this.actionHandlers = new Map();
        this.createServer();
    }
    createServer() {
        if (this.permanentlyClosed) {
            return;
        }
        if (!config_1.Config.get().VSERVER_TLS) {
            this.restServer = http.createServer();
        }
        else {
            this.restServer = https.createServer(this.loadCertificate());
            if (!this.watchingCert) {
                this.watchingCert = true;
                FS.watchFile(config_1.Config.get().VSERVER_CERTPATH, (curr, prev) => {
                    if (curr.mtime !== prev.mtime) {
                        setTimeout(() => {
                            log_1.Log.info("Reloading certificate.");
                            const newCertificate = this.loadCertificate();
                            if (newCertificate !== undefined) {
                                try {
                                    this.restServer._sharedCreds.context.setCert(newCertificate.cert);
                                    this.restServer._sharedCreds.context.setKey(newCertificate.key);
                                }
                                catch (error) {
                                    log_1.Log.error("Problem with reloading certificate.");
                                }
                            }
                        }, 5000);
                    }
                });
            }
        }
        this.timeout = config_1.Config.get().VSERVER_TIMEOUT;
        this.serverOptions = {
            maxPayload: 1000000,
            server: this.restServer
        };
        this.server = new WebSocket.Server(this.serverOptions);
        this.restServer.listen(this.port);
        this.server.on("listening", () => { this.serverListening = true; this.restartTimeout = 5000; });
        this.server.on("error", (error) => {
            log_1.Log.warn("Server error", error);
            if (!this.serverListening) {
                this.restartTimeout = Math.min(this.restartTimeout * 1.5, 300000);
                this.shutdownServer(false).then(() => setTimeout(() => this.createServer(), this.restartTimeout)).catch();
            }
            else {
                this.shutdownServer(false).then(() => setTimeout(() => this.createServer(), 5000)).catch();
            }
        });
        let currentTimer = this.timeout;
        let clientsToCheck = [];
        const interval = setInterval(() => {
            if (this.serverListening) {
                currentTimer--;
                if (currentTimer === 0) {
                    clientsToCheck = Array.from(this.server.clients);
                    currentTimer = this.timeout;
                }
                const clientsToCheckThisTime = Math.ceil(1 / currentTimer * clientsToCheck.length);
                for (let i = 0; i < clientsToCheckThisTime; i++) {
                    const client = clientsToCheck.pop();
                    if (client.readyState === WebSocket.OPEN) {
                        if (!client.isAlive) {
                            client.terminate();
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
        this.server.on("connection", (client, request) => {
            log_1.Log.debug(`Worker ${this.worker.id} received an incomming connection.`);
            if (request.url === undefined) {
                client.close(4100, "Invalid way of connecting.");
                client.terminate();
                return;
            }
            const urlParts = request.url.match(/[^\/]+/g);
            if (urlParts === null || urlParts.length < 1 || !this.apiVersions.has(urlParts[urlParts.length - 1])) {
                client.close(4100, "Version of the api is not supported.");
                client.terminate();
                return;
            }
            const AH = new (this.apiVersions.get(urlParts[urlParts.length - 1]))(this, client);
            this.actionHandlers.set(client, AH);
            client.isAlive = true;
            client.on("error", (error) => {
                this.terminateClient(client, "Web socket error", error);
            });
            client.on("close", () => {
                log_1.Log.debug(`A connection to worker ${this.worker.id} closed.`);
                this.terminateClient(client);
            });
            client.on("pong", () => {
                client.isAlive = true;
            });
            client.on("message", (messageData) => {
                log_1.Log.debug(`Received: ${messageData}`);
                let message;
                try {
                    message = JSON.parse(messageData.toString());
                }
                catch (error) {
                    return this.sendError(AH, "", "Invalid JSON");
                }
                if (typeof message.id !== "string") {
                    return this.sendError(AH, "", "Request is missing or has an invalid an ID field");
                }
                if (typeof message.type !== "string") {
                    return this.sendError(AH, message.id, "Request is missing or has an invalid request type");
                }
                AH.receiveMessage(message.type, message.data)
                    .then((responseData) => this.sendResponse(AH, message.id, responseData))
                    .catch((error) => this.sendError(AH, message.id, error instanceof Error ? error.message : error));
            });
        });
    }
    sendResponse(ah, responseObject, data) {
        const client = ah.client;
        if (client.readyState === client.OPEN && this.serverListening && typeof responseObject === "string") {
            const response = {
                id: responseObject
            };
            if (data !== undefined) {
                response.data = data;
            }
            const responseString = JSON.stringify(response);
            log_1.Log.debug(`Send response: ${responseString}`);
            client.send(responseString, (error) => {
                if (error !== undefined) {
                    this.terminateClient(client, "Failed to send message", error);
                }
            });
        }
        else {
            log_1.Log.warn(`Cannot send message, client state: ${client.readyState}, server online: ${this.serverListening}`);
        }
    }
    sendPush(ah, pushType, data) {
        const client = ah.client;
        if (client.readyState === client.OPEN && this.serverListening) {
            const push = {
                pushType,
                data
            };
            const pushString = JSON.stringify(push);
            log_1.Log.debug(`Send push: ${pushString}`);
            client.send(pushString, (error) => {
                if (error !== undefined) {
                    this.terminateClient(client, "Failed to send message", error);
                }
            });
        }
        else {
            log_1.Log.warn(`Cannot send message, client state: ${client.readyState}, server online: ${this.serverListening}`);
        }
    }
    sendError(ah, responseObject, error) {
        const client = ah.client;
        if (client.readyState === client.OPEN && this.serverListening) {
            const errorResponse = {
                error
            };
            if (responseObject !== undefined) {
                errorResponse.id = responseObject;
            }
            log_1.Log.debug(`Send error (${responseObject}): ${error}`);
            client.send(JSON.stringify(errorResponse), (sendError) => {
                if (sendError !== undefined) {
                    this.terminateClient(client, "Failed to send message", sendError);
                }
            });
        }
        else {
            log_1.Log.warn(`Cannot send message, client state: ${client.readyState}, server online: ${this.serverListening}`);
        }
    }
    shutdownServer(permanent) {
        return __awaiter(this, void 0, void 0, function* () {
            this.permanentlyClosed = this.permanentlyClosed || permanent;
            if (this.isClosingServer) {
                if (this.permanentlyClosed) {
                    return Promise.resolve();
                }
                else {
                    return Promise.reject(new Error("Server already closing."));
                }
            }
            else {
                this.isClosingServer = true;
                for (const client of this.actionHandlers.keys()) {
                    client.close(1001, "Server shutting down/restarting.");
                    this.terminateClient(client);
                }
                return new Promise((resolve) => {
                    this.server.close(() => {
                        this.restServer.close(() => {
                            this.serverListening = false;
                            this.isClosingServer = false;
                            resolve();
                        });
                    });
                });
            }
        });
    }
    terminateClient(client, errorDescription, error) {
        if (error !== undefined) {
            if (error.message !== "read ECONNRESET") {
                log_1.Log.warn(errorDescription !== undefined ? errorDescription : "", error);
            }
        }
        else if (errorDescription !== undefined) {
            log_1.Log.warn(errorDescription, error);
        }
        if (this.actionHandlers.has(client)) {
            this.actionHandlers.get(client).terminate();
            client.terminate();
            this.actionHandlers.delete(client);
        }
    }
    loadCertificate() {
        try {
            return {
                key: FS.readFileSync(config_1.Config.get().VSERVER_KEYPATH),
                cert: FS.readFileSync(config_1.Config.get().VSERVER_CERTPATH)
            };
        }
        catch (error) {
            log_1.Log.error(`Failed to load certificate at: key: ${config_1.Config.get().VSERVER_KEYPATH} and cert: ${config_1.Config.get().VSERVER_CERTPATH}.`);
            return undefined;
        }
    }
}
exports.WebsocketHandler = WebsocketHandler;
//# sourceMappingURL=wshandler.js.map