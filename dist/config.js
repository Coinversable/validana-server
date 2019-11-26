"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Cluster = require("cluster");
const FS = require("fs");
const Path = require("path");
const crypto_1 = require("./tools/crypto");
const log_1 = require("./tools/log");
class Config {
    static get() {
        if (Config.config === undefined) {
            Config.loadEnv();
            if (Cluster.isMaster) {
                Config.loadFile();
                Config.validate();
            }
            Config.config = Object.assign(Config.stringConfig, Config.numberConfig, Config.booleanConfig);
        }
        return Config.config;
    }
    static addStringConfig(name, defaultValue, validator) {
        if (Config.stringConfig[name] !== undefined) {
            log_1.Log.warn(`Overwriting config: ${name}`);
        }
        Config.stringConfig[name] = defaultValue;
        if (validator !== undefined) {
            Config.validators.push(() => validator(Config.stringConfig[name], Config));
        }
        return Config;
    }
    static addNumberConfig(name, defaultValue, validator) {
        if (Config.numberConfig[name] !== undefined) {
            log_1.Log.warn(`Overwriting config: ${name}`);
        }
        Config.numberConfig[name] = defaultValue;
        if (validator !== undefined) {
            Config.validators.push(() => validator(Config.numberConfig[name], Config));
        }
        return Config;
    }
    static addBoolConfig(name, defaultValue, validator) {
        if (Config.booleanConfig[name] !== undefined) {
            log_1.Log.warn(`Overwriting config: ${name}`);
        }
        Config.booleanConfig[name] = defaultValue;
        if (validator !== undefined) {
            Config.validators.push(() => validator(Config.booleanConfig[name], Config));
        }
        return Config;
    }
    static loadEnv() {
        for (const key of Object.keys(Config.stringConfig)) {
            const processKey = process.env[key];
            if (processKey !== undefined) {
                Config.stringConfig[key] = processKey;
            }
        }
        for (const key of Object.keys(Config.numberConfig)) {
            const processKey = process.env[key];
            if (processKey !== undefined) {
                const envValue = Number.parseInt(processKey);
                if (!Number.isSafeInteger(envValue)) {
                    throw new Error(`Invalid value for environment variable: ${key}, expected a number.`);
                }
                else {
                    Config.numberConfig[key] = envValue;
                }
            }
        }
        for (const key of Object.keys(Config.booleanConfig)) {
            const processKey = process.env[key];
            if (processKey !== undefined) {
                if (processKey !== "true" && processKey !== "false") {
                    throw new Error(`Invalid value: ${processKey} for environment variable: ${key}, expected 'true' or 'false'.`);
                }
                else {
                    Config.booleanConfig[key] = processKey === "true";
                }
            }
        }
    }
    static loadFile() {
        if (process.argv.length >= 3) {
            const configPath = Path.resolve(process.argv[process.argv.length - 1]);
            if (!FS.existsSync(configPath)) {
                throw new Error(`Unable to find file: ${configPath}.`);
            }
            let configFile;
            try {
                configFile = JSON.parse(crypto_1.Crypto.binaryToUtf8(FS.readFileSync(configPath)));
            }
            catch (error) {
                throw new Error(`Unable to load config file: ${configPath}: ${error.stack}.`);
            }
            for (const key of Object.keys(configFile)) {
                if (Config.stringConfig.hasOwnProperty(key)) {
                    if (typeof configFile[key] !== "string") {
                        throw new Error(`Invalid type in config file for key: ${key}, expected a string.`);
                    }
                    else {
                        Config.stringConfig[key] = configFile[key].toString();
                    }
                }
                else if (Config.numberConfig.hasOwnProperty(key)) {
                    if (!Number.isSafeInteger(configFile[key])) {
                        throw new Error(`Invalid type in config file for key: ${key}, expected an integer.`);
                    }
                    else {
                        Config.numberConfig[key] = configFile[key];
                    }
                }
                else if (Config.booleanConfig.hasOwnProperty(key)) {
                    if (typeof configFile[key] !== "boolean") {
                        throw new Error(`Invalid type in config file for key: ${key}, expected a boolean.`);
                    }
                    else {
                        Config.booleanConfig[key] = configFile[key];
                    }
                }
                else {
                    log_1.Log.warn(`Unknown config file key: ${key}`);
                }
            }
        }
    }
    static validate() {
        if (Config.numberConfig.VSERVER_DBPORT <= 0 || Config.numberConfig.VSERVER_DBPORT > 65535) {
            throw new Error(`Invalid db port: ${Config.numberConfig.VSERVER_DBPORT}, should be 1-65535.`);
        }
        if (Config.numberConfig.VSERVER_RESTPORT < 0 || Config.numberConfig.VSERVER_RESTPORT > 65535) {
            throw new Error(`Invalid http port: ${Config.numberConfig.VSERVER_RESTPORT}, should be 0-65535.`);
        }
        if (Config.numberConfig.VSERVER_WSPORT < 0 || Config.numberConfig.VSERVER_WSPORT > 65535) {
            throw new Error(`Invalid ws port: ${Config.numberConfig.VSERVER_WSPORT}, should be 0-65535.`);
        }
        if (Config.numberConfig.VSERVER_RESTPORT === Config.numberConfig.VSERVER_WSPORT) {
            if (Config.numberConfig.VSERVER_RESTPORT !== 0) {
                throw new Error(`Invalid ws and rest ports, they may not be the same.`);
            }
            else {
                throw new Error(`Invalid ws and rest ports, at least one should be defined.`);
            }
        }
        if (Config.numberConfig.VSERVER_LOGLEVEL < log_1.Log.Debug || Config.numberConfig.VSERVER_LOGLEVEL > log_1.Log.None) {
            throw new Error(`Invalid log level: ${Config.numberConfig.VSERVER_LOGLEVEL}, should be 0-5.`);
        }
        if (Config.numberConfig.VSERVER_TIMEOUT < 5) {
            throw new Error(`Invalid block interval: ${Config.numberConfig.VSERVER_TIMEOUT}, should be at least 5 seconds.`);
        }
        if (Config.numberConfig.VSERVER_UPDATEINTERVAL <= 0) {
            throw new Error(`Invalid update interval: ${Config.numberConfig.VSERVER_UPDATEINTERVAL}, should be at least 1 second.`);
        }
        if (Config.numberConfig.VSERVER_MAXMEMORY < 50) {
            throw new Error(`Invalid max memory: ${Config.numberConfig.VSERVER_MAXMEMORY}, should be at least 50 MB.`);
        }
        if (Config.booleanConfig.VSERVER_TLS && (Config.stringConfig.VSERVER_KEYPATH === "" || Config.stringConfig.VSERVER_CERTPATH === "")) {
            throw new Error("Invalid keypath or certpath, using tls but one of them is undefined.");
        }
        if (Config.booleanConfig.VSERVER_TLS) {
            Config.stringConfig.VSERVER_KEYPATH = Path.resolve(Config.stringConfig.VSERVER_KEYPATH);
            Config.stringConfig.VSERVER_CERTPATH = Path.resolve(Config.stringConfig.VSERVER_CERTPATH);
            if (!FS.existsSync(Config.stringConfig.VSERVER_CERTPATH)) {
                throw new Error(`Invalid keypath: Unable to find file ${Config.stringConfig.VSERVER_KEYPATH}`);
            }
            if (!FS.existsSync(Config.stringConfig.VSERVER_CERTPATH)) {
                throw new Error(`Invalid keypath: Unable to find file ${Config.stringConfig.VSERVER_CERTPATH}`);
            }
        }
        let hasApi = false;
        try {
            const apis = JSON.parse(Config.stringConfig.VSERVER_API);
            for (const apiName of Object.keys(apis)) {
                hasApi = true;
                try {
                    if (typeof (require(Path.resolve(apis[apiName])).default) !== "function") {
                        throw new Error(`The Api ${apis[apiName]} as found in: ${Config.stringConfig.VSERVER_API}, must contain a default exported class extending actionhandler.`);
                    }
                }
                catch (error) {
                    throw new Error(`Could not find file ${Path.resolve(apis[apiName])} as found in: ${Config.stringConfig.VSERVER_API}: ${error.message}: ${error.stack}`);
                }
            }
        }
        catch (error) {
            throw new Error(`Invalid api: ${Config.stringConfig.VSERVER_API}: ${error.message}: ${error.stack}`);
        }
        if (!hasApi) {
            throw new Error(`No provided api: ${Config.stringConfig.VSERVER_API}.`);
        }
        for (const validator of Config.validators) {
            validator();
        }
    }
}
exports.Config = Config;
Config.config = undefined;
Config.validators = new Array();
Config.stringConfig = {
    VSERVER_DBUSER: "backend",
    VSERVER_DBNAME: "blockchain",
    VSERVER_DBHOST: "localhost",
    VSERVER_DBPASSWORD: "",
    VSERVER_SENTRYURL: "",
    VSERVER_API: "",
    VSERVER_KEYPATH: "",
    VSERVER_CERTPATH: ""
};
Config.numberConfig = {
    VSERVER_LOGLEVEL: 0,
    VSERVER_DBPORT: 5432,
    VSERVER_RESTPORT: 0,
    VSERVER_WSPORT: 0,
    VSERVER_TIMEOUT: 60,
    VSERVER_UPDATEINTERVAL: 3,
    VSERVER_MAXMEMORY: 256,
    VSERVER_WORKERS: -1
};
Config.booleanConfig = {
    VSERVER_TLS: true
};
//# sourceMappingURL=config.js.map