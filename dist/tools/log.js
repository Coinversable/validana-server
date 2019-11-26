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
const Raven = require("raven");
const os = require("os");
var c;
(function (c) {
    c["red"] = "\u001B[31m";
    c["green"] = "\u001B[32m";
    c["yellow"] = "\u001B[33m";
    c["blue"] = "\u001B[34m";
    c["mangata"] = "\u001B[35m";
    c["cyan"] = "\u001B[36m";
    c["white"] = "\u001B[37m";
    c["grey"] = "\u001B[90m";
})(c || (c = {}));
class Log {
    static setReportErrors(dns) {
        this.reportErrors = true;
        Raven.config(dns);
    }
    static isReportingErrors() {
        return this.reportErrors;
    }
    static debug(msg, error) {
        if (Log.Level <= Log.Debug) {
            console.log(`${c.grey}${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}${c.white}`);
        }
    }
    static info(msg, error) {
        if (Log.Level <= Log.Info) {
            console.log(`${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}`);
        }
        if (this.reportErrors) {
            if (error !== undefined) {
                Raven.captureBreadcrumb({ level: "info", message: msg, data: { stack: error.stack } });
            }
            else {
                Raven.captureBreadcrumb({ level: "info", message: msg });
            }
        }
    }
    static warn(msg, error) {
        if (Log.Level <= Log.Warning) {
            console.log(`${c.yellow}${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}${c.white}`);
        }
        if (this.reportErrors) {
            if (error !== undefined) {
                Raven.captureBreadcrumb({ level: "warning", message: msg, data: { stack: error.stack } });
            }
            else {
                Raven.captureBreadcrumb({ level: "warning", message: msg });
            }
        }
    }
    static error(msg, error) {
        return __awaiter(this, void 0, void 0, function* () {
            if (Log.Level <= Log.Error) {
                console.error(`${c.red}${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}${c.white}`);
            }
            if (this.reportErrors) {
                this.options.level = "error";
                if (error !== undefined) {
                    this.options.extra.message = msg;
                    return this.captureError(error, this.options);
                }
                else {
                    return this.captureMessage(msg, this.options);
                }
            }
        });
    }
    static fatal(msg, error) {
        return __awaiter(this, void 0, void 0, function* () {
            if (Log.Level <= Log.Fatal) {
                console.error(`${c.red}${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}${c.white}`);
            }
            if (this.reportErrors) {
                this.options.level = "fatal";
                if (error !== undefined) {
                    this.options.extra.message = msg;
                    return this.captureError(error, this.options);
                }
                else {
                    return this.captureMessage(msg, this.options);
                }
            }
        });
    }
    static captureError(error, options) {
        return new Promise((resolve) => {
            Raven.captureException(error, options, (err) => {
                if (err !== null && err !== undefined) {
                    Log.warn("Could not report error, is the sentry url valid?");
                }
                resolve();
            });
        });
    }
    static captureMessage(message, options) {
        return new Promise((resolve) => {
            Raven.captureMessage(message, options, (err) => {
                if (err !== null && err !== undefined) {
                    Log.warn("Could not report error, is the sentry url valid?");
                }
                resolve();
            });
        });
    }
}
exports.Log = Log;
Log.Debug = 0;
Log.Info = 1;
Log.Warning = 2;
Log.Error = 3;
Log.Fatal = 4;
Log.None = 5;
Log.Level = Log.Warning;
Log.reportErrors = false;
Log.options = {
    tags: {
        serverVersion: "1.0.1",
        nodejsVersion: process.versions.node,
        arch: process.arch,
        platform: process.platform,
        platformVersion: os.release()
    },
    extra: {}
};
//# sourceMappingURL=log.js.map