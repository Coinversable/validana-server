"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const http = require("http");
const https = require("https");
const FS = require("fs");
const validana_core_1 = require("@coinversable/validana-core");
const config_1 = require("../config");
const events_1 = require("events");
class HttpServer extends events_1.EventEmitter {
    constructor(port) {
        super();
        this.permanentlyClosed = false;
        this.restartTimeout = 5000;
        this.port = port;
        if (!config_1.Config.get().VSERVER_TLS) {
            this.server = http.createServer();
        }
        else {
            this.server = https.createServer(this.loadCertificate());
            FS.watchFile(config_1.Config.get().VSERVER_CERTPATH, (curr, prev) => {
                if (curr.mtime !== prev.mtime) {
                    setTimeout(() => {
                        validana_core_1.Log.info("Reloading certificate.");
                        const newCertificate = this.loadCertificate();
                        if (newCertificate !== undefined) {
                            try {
                                if (this.server.setSecureContext instanceof Function) {
                                    this.server.setSecureContext(newCertificate);
                                }
                                else {
                                    this.server._sharedCreds.context.setCert(newCertificate.cert);
                                    this.server._sharedCreds.context.setKey(newCertificate.key);
                                }
                            }
                            catch (error) {
                                validana_core_1.Log.error("Problem with reloading certificate.");
                            }
                        }
                    }, 5000);
                }
            });
        }
        this.server.on("listening", () => this.restartTimeout = 5000);
        this.server.on("error", async (error) => {
            validana_core_1.Log.warn("Server error", error);
            if (!this.server.listening) {
                this.restartTimeout = Math.min(this.restartTimeout * 1.5, 300000);
                await this.shutdown(false, true);
                setTimeout(() => {
                    if (!this.permanentlyClosed) {
                        this.server.listen(this.port);
                    }
                }, this.restartTimeout);
            }
            else {
                await this.shutdown(false, true);
                setTimeout(() => {
                    if (!this.permanentlyClosed) {
                        this.server.listen(this.port);
                    }
                }, this.restartTimeout);
            }
        });
        this.server.listen(this.port);
    }
    async shutdown(permanent, graceful) {
        this.permanentlyClosed = this.permanentlyClosed || permanent;
        this.server.close();
        this.emit("close", permanent, graceful);
    }
    loadCertificate() {
        try {
            return {
                key: FS.readFileSync(config_1.Config.get().VSERVER_KEYPATH),
                cert: FS.readFileSync(config_1.Config.get().VSERVER_CERTPATH)
            };
        }
        catch (error) {
            validana_core_1.Log.error(`Failed to load certificate at: key: ${config_1.Config.get().VSERVER_KEYPATH} and cert: ${config_1.Config.get().VSERVER_CERTPATH}.`);
            return undefined;
        }
    }
    on(event, listener) {
        return super.on(event, listener);
    }
}
exports.HttpServer = HttpServer;
