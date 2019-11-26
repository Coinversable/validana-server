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
const http = require("http");
const https = require("https");
const FS = require("fs");
const handler_1 = require("./handler");
const config_1 = require("../config");
const log_1 = require("../tools/log");
class RestHandler extends handler_1.Handler {
    constructor(worker, port) {
        super(worker, port);
        this.isClosingServer = false;
        this.restartTimeout = 5000;
        this.permanentlyClosed = false;
        this.actionHandlers = new Map();
        if (!config_1.Config.get().VSERVER_TLS) {
            this.server = http.createServer();
        }
        else {
            this.server = https.createServer(this.loadCertificate());
            FS.watchFile(config_1.Config.get().VSERVER_CERTPATH, (curr, prev) => {
                if (curr.mtime !== prev.mtime) {
                    setTimeout(() => {
                        log_1.Log.info("Reloading certificate.");
                        const newCertificate = this.loadCertificate();
                        if (newCertificate !== undefined) {
                            try {
                                this.server._sharedCreds.context.setCert(newCertificate.cert);
                                this.server._sharedCreds.context.setKey(newCertificate.key);
                            }
                            catch (error) {
                                log_1.Log.error("Problem with reloading certificate.");
                            }
                        }
                    }, 5000);
                }
            });
        }
        this.server.on("request", (req, res) => {
            if (req.method === "OPTIONS") {
                res.writeHead(200, RestHandler.headerOptions);
                res.end();
                return;
            }
            if (req.url === undefined) {
                res.writeHead(400, RestHandler.headerOptions);
                res.end("Missing url.");
                return;
            }
            const urlParts = req.url.match(/[^\/]+/g);
            if (urlParts === null || urlParts.length < 2) {
                res.writeHead(400, RestHandler.headerOptions);
                res.end("Missing api version or request type.");
                return;
            }
            const version = urlParts[urlParts.length - 2];
            if (!this.apiVersions.has(version)) {
                res.writeHead(501, RestHandler.headerOptions);
                res.end("Api version missing or not supported.");
                return;
            }
            const query = urlParts[urlParts.length - 1];
            const index = query.indexOf("?");
            const type = index === -1 ? query : query.slice(0, index);
            let data;
            if (req.method === "GET") {
                if (index !== -1) {
                    try {
                        data = JSON.parse(decodeURIComponent(query.slice(index + 1)));
                    }
                    catch (error) {
                        res.writeHead(400, RestHandler.headerOptions);
                        res.end("Invalid request json.");
                        return;
                    }
                }
            }
            else if (req.method === "POST") {
                let body = "";
                req.on("data", (postData) => {
                    body += postData.toString();
                    if (body.length > 1000000) {
                        res.writeHead(413, RestHandler.headerOptions);
                        res.end("Payload too large.");
                        return;
                    }
                });
                req.on("end", () => {
                    if (body.length > 0) {
                        try {
                            data = JSON.parse(body);
                        }
                        catch (error) {
                            res.writeHead(400, RestHandler.headerOptions);
                            res.end("Invalid request json.");
                            return;
                        }
                    }
                    const AHPost = new (this.apiVersions.get(version))(this, undefined);
                    this.actionHandlers.set(req.socket, AHPost);
                    AHPost.receiveMessage(type, data)
                        .then((responseData) => this.sendResponse(AHPost, res, responseData))
                        .catch((error) => this.sendError(AHPost, res, error instanceof Error ? error.message : error));
                });
                return;
            }
            else {
                res.writeHead(405, RestHandler.headerOptions);
                res.end("Invalid request method.");
                return;
            }
            const AHGet = new (this.apiVersions.get(version))(this, undefined);
            this.actionHandlers.set(req.socket, AHGet);
            AHGet.receiveMessage(type, data)
                .then((responseData) => this.sendResponse(AHGet, res, responseData))
                .catch((error) => this.sendError(AHGet, res, error instanceof Error ? error.message : error));
        });
        this.server.on("listening", () => this.restartTimeout = 5000);
        this.server.on("error", (error) => {
            log_1.Log.warn("Server error", error);
            if (!this.server.listening) {
                this.restartTimeout = Math.min(this.restartTimeout * 1.5, 300000);
                this.shutdownServer(false).then(() => setTimeout(() => {
                    if (!this.permanentlyClosed) {
                        this.server.listen(config_1.Config.get().VSERVER_RESTPORT);
                    }
                }, this.restartTimeout)).catch();
            }
            else {
                this.shutdownServer(false).then(() => setTimeout(() => {
                    if (!this.permanentlyClosed) {
                        this.server.listen(config_1.Config.get().VSERVER_RESTPORT);
                    }
                }, this.restartTimeout)).catch();
            }
        });
        this.server.listen(this.port);
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
                    this.actionHandlers.get(client).terminate();
                    client.destroy();
                    this.actionHandlers.delete(client);
                }
                return new Promise((resolve) => {
                    this.server.close(() => {
                        this.isClosingServer = false;
                        resolve();
                    });
                });
            }
        });
    }
    sendResponse(ah, responseObject, data) {
        if (this.server.listening && responseObject instanceof http.ServerResponse &&
            responseObject.connection !== null && !responseObject.connection.destroyed) {
            const dataString = JSON.stringify(data);
            log_1.Log.debug(`Send response: ${dataString}`);
            responseObject.writeHead(200, RestHandler.headerOptions);
            responseObject.end(dataString);
            ah.terminate();
        }
        else {
            log_1.Log.warn(`Cannot send message, server online: ${this.server.listening}`);
        }
    }
    sendPush(_, pushType, data) {
        log_1.Log.warn(`Push type: ${pushType}, pushData: ${JSON.stringify(data)}`);
        log_1.Log.error("Tried to send push for a http handler.");
    }
    sendError(ah, responseObject, error) {
        if (this.server.listening && responseObject instanceof http.ServerResponse &&
            responseObject.connection !== null && !responseObject.connection.destroyed) {
            log_1.Log.debug(`Send error: ${error}`);
            responseObject.writeHead(500, RestHandler.headerOptions);
            responseObject.end(error);
            if (ah !== undefined) {
                ah.terminate();
            }
        }
        else {
            log_1.Log.warn(`Cannot send message}, server online: ${this.server.listening}`);
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
exports.RestHandler = RestHandler;
RestHandler.headerOptions = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET",
    "Access-Control-Allow-Headers": "origin, content-type, accept",
    "Access-Control-Max-Age": 86400
};
//# sourceMappingURL=resthandler.js.map