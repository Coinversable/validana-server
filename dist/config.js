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
const FS = require("fs");
const Path = require("path");
const validana_core_1 = require("@coinversable/validana-core");
class Config {
    static get() {
        if (!Config.loadedConfig) {
            Config.loadEnv();
            if (Cluster.isMaster) {
                Config.loadFile();
            }
            Config.loadDefaults();
            if (Cluster.isMaster) {
                Config.validate();
            }
            Config.loadedConfig = true;
        }
        return Config.config;
    }
    static addStringConfig(name, defaultValue, validator) {
        if (typeof defaultValue === "function") {
            validator = defaultValue;
            defaultValue = undefined;
        }
        if (typeof name === "string") {
            Config.toLoadString.set(name, { type: "string", defaultValue, validator: validator });
        }
        else {
            Config.toLoadRegExp.set(name, { type: "string", validator: validator });
        }
        return Config;
    }
    static addNumberConfig(name, defaultValue, validator) {
        if (typeof defaultValue === "function") {
            validator = defaultValue;
        }
        if (typeof name === "string") {
            Config.toLoadString.set(name, { type: "number", defaultValue, validator: validator });
        }
        else {
            Config.toLoadRegExp.set(name, { type: "number", validator: validator });
        }
        return Config;
    }
    static addBoolConfig(name, defaultValue, validator) {
        if (typeof defaultValue === "function") {
            validator = defaultValue;
        }
        if (typeof name === "string") {
            Config.toLoadString.set(name, { type: "boolean", defaultValue, validator: validator });
        }
        else {
            Config.toLoadRegExp.set(name, { type: "boolean", validator: validator });
        }
        return Config;
    }
    static addObjectConfig(name, defaultValue, validator) {
        if (typeof defaultValue === "function") {
            validator = defaultValue;
            defaultValue = undefined;
        }
        if (typeof name === "string") {
            Config.toLoadString.set(name, { type: "object", defaultValue, validator: validator });
        }
        else {
            Config.toLoadRegExp.set(name, { type: "object", validator: validator });
        }
        return Config;
    }
    static loadEnv() {
        const newConfig = {};
        const regexps = Array.from(Config.toLoadRegExp.keys());
        for (const key of Object.keys(process.env)) {
            let type;
            if (Config.toLoadString.has(key)) {
                type = Config.toLoadString.get(key).type;
            }
            else {
                const matchingRegExp = regexps.find((regexp) => key.match(regexp) !== null);
                if (matchingRegExp !== undefined) {
                    type = Config.toLoadRegExp.get(matchingRegExp).type;
                }
            }
            if (type === "number") {
                newConfig[key] = Number.parseInt(process.env[key], 10);
            }
            else if (type === "boolean") {
                if (process.env[key] !== "true" && process.env[key] !== "false") {
                    throw new Error(`Invalid environment value for key: ${key}, expected a boolean.`);
                }
                newConfig[key] = process.env[key] === "true";
            }
            else if (type === "object") {
                try {
                    newConfig[key] = JSON.parse(process.env[key]);
                }
                catch (error) {
                    throw new Error(`Invalid environment value for key: ${key}, expected an object.`);
                }
            }
            else if (type === "string") {
                newConfig[key] = process.env[key];
            }
        }
        Object.assign(Config.config, newConfig);
    }
    static loadFile() {
        if (process.argv.length >= 3) {
            const configPath = Path.resolve(process.argv[process.argv.length - 1]);
            if (!FS.existsSync(configPath)) {
                throw new Error(`Unable to find file: ${configPath}.`);
            }
            let configFile;
            try {
                configFile = JSON.parse(validana_core_1.Crypto.binaryToUtf8(FS.readFileSync(configPath)));
            }
            catch (error) {
                throw new Error(`Unable to load config file: ${configPath}: ${error.stack}.`);
            }
            if (typeof configFile !== "object" || configFile === null) {
                throw new Error(`Invalid config file.`);
            }
            const newConfig = {};
            const regexps = Array.from(Config.toLoadRegExp.keys());
            for (const key of Object.keys(configFile)) {
                if (Config.toLoadString.has(key)) {
                    newConfig[key] = configFile[key];
                }
                else if (regexps.find((regexp) => key.match(regexp) !== null) !== undefined) {
                    newConfig[key] = configFile[key];
                }
                else {
                    validana_core_1.Log.warn(`Unknown config file key: ${key}`);
                }
            }
            Object.assign(Config.config, newConfig);
        }
    }
    static loadDefaults() {
        for (const toLoad of Config.toLoadString.keys()) {
            if (Config.config[toLoad] === undefined && Config.toLoadString.get(toLoad).defaultValue !== undefined) {
                Config.config[toLoad] = Config.toLoadString.get(toLoad).defaultValue;
            }
        }
    }
    static validate() {
        var _a, _b, _c, _d;
        for (const key of Config.toLoadString.keys()) {
            const toLoad = Config.toLoadString.get(key);
            if (Config.config[key] !== undefined && (typeof Config.config[key] !== toLoad.type ||
                Config.config[key] === null || toLoad.type === "number" && !Number.isSafeInteger(Config.config[key]))) {
                throw new Error(`Invalid value for key: ${key}, expected a ${toLoad.type}.`);
            }
            (_b = (_a = toLoad).validator) === null || _b === void 0 ? void 0 : _b.call(_a, Config.config[key], Config.config, key);
        }
        for (const key of Object.keys(Config.config)) {
            for (const regExp of Config.toLoadRegExp.keys()) {
                if (key.match(regExp) !== null) {
                    const toLoad = Config.toLoadRegExp.get(regExp);
                    if (typeof Config.config[key] !== toLoad.type || Config.config[key] === null
                        || toLoad.type === "number" && !Number.isSafeInteger(Config.config[key])) {
                        throw new Error(`Invalid value for key: ${key}, expected a ${toLoad.type}.`);
                    }
                    (_d = (_c = toLoad).validator) === null || _d === void 0 ? void 0 : _d.call(_c, Config.config[key], Config.config, key);
                }
            }
        }
    }
}
exports.Config = Config;
Config.toLoadString = new Map();
Config.toLoadRegExp = new Map();
Config.config = {};
Config.loadedConfig = false;
Config.addNumberConfig("VSERVER_LOGLEVEL", 0, (value) => {
    if (value < validana_core_1.Log.Debug || value > validana_core_1.Log.None) {
        throw new Error(`Invalid log level: ${value}, should be 0 - 5.`);
    }
});
Config.addNumberConfig("VSERVER_DBMINCONNECTIONS", 0, (value, config) => {
    if (value < 0 || value > config.VSERVER_DBMAXCONNECTIONS) {
        throw new Error(`Invalid number of db connections(min: ${value}, max: ${config.VSERVER_DBMAXCONNECTIONS}).`);
    }
});
Config.addNumberConfig("VSERVER_DBMAXCONNECTIONS", 10, (value, config) => {
    if (value <= 0 || value < config.VSERVER_DBMINCONNECTIONS) {
        throw new Error(`Invalid number of db connections(min: ${config.VSERVER_DBMINCONNECTIONS}, max: ${value}).`);
    }
});
Config.addNumberConfig("VSERVER_DBPORT", 5432, (value) => {
    if (value <= 0 || value > 65535) {
        throw new Error(`Invalid db port: ${value}, should be 1 - 65535.`);
    }
});
Config.addNumberConfig("VSERVER_RESTPORT");
Config.addNumberConfig("VSERVER_HTTPPORT", undefined, (value, config) => {
    if (value === undefined) {
        if (config.VSERVER_RESTPORT !== undefined) {
            validana_core_1.Log.warn("VSERVER_RESTPORT is depricated, use VSERVER_HTTPPORT");
            config.VSERVER_HTTPPORT = config.VSERVER_RESTPORT;
        }
        else {
            config.VSERVER_HTTPPORT = 8080;
            config.VSERVER_RESTPORT = 8080;
        }
    }
    else {
        if (value < 0 || value > 65535) {
            throw new Error(`Invalid ws port: ${value}, should be 0 - 65535.`);
        }
        if (value === 0 && config.VSERVER_RESTPORT === 0) {
            throw new Error(`Invalid http or ws port, at least one should be defined.`);
        }
        config.VSERVER_RESTPORT = value;
    }
});
Config.addNumberConfig("VSERVER_WSPORT", 8080, (value) => {
    if (value < 0 || value > 65535) {
        throw new Error(`Invalid ws port: ${value}, should be 0 - 65535.`);
    }
});
Config.addNumberConfig("VSERVER_MAXPAYLOADSIZE", 1000000, (value) => {
    if (value < 0) {
        throw new Error(`Invalid max payload size: ${value}, should be 0 or higher.`);
    }
});
Config.addNumberConfig("VSERVER_TIMEOUT", 60, (value) => {
    if (value < 5) {
        throw new Error(`Invalid keep alive timeout: ${value}, should be at least 5 seconds.`);
    }
});
Config.addNumberConfig("VSERVER_MAXMEMORY", 0, (value) => {
    if (value < 50 && value !== 0) {
        throw new Error(`Invalid max memory: ${value}, should be at least 50 (MB), or 0 for no limit.`);
    }
});
Config.addNumberConfig("VSERVER_METRICSINTERVAL", 0, (value) => {
    if (value < 0) {
        throw new Error(`Invalid metrics interval: ${value}, should be a positive number (or 0 for never).`);
    }
});
Config.addNumberConfig("VSERVER_WORKERS", -1);
Config.addStringConfig("VSERVER_DBUSER", "backend");
Config.addStringConfig("VSERVER_DBNAME", "blockchain");
Config.addStringConfig("VSERVER_DBHOST", "localhost");
Config.addStringConfig("VSERVER_DBPASSWORD", undefined);
Config.addStringConfig("VSERVER_SENTRYURL", undefined);
Config.addStringConfig("VSERVER_KEYPATH", undefined);
Config.addStringConfig("VSERVER_CERTPATH", undefined);
Config.addStringConfig("VSERVER_LOGFORMAT", undefined);
Config.addStringConfig("VSERVER_METRICSTOKEN", undefined);
Config.addStringConfig("VSERVER_API", undefined, (value) => {
    if (value !== undefined) {
        let apis;
        try {
            apis = JSON.parse(value);
        }
        catch (error) {
            throw new Error(`Invalid api: ${value}: ${error.message}: ${error.stack}`);
        }
        for (const apiName of Object.keys(apis)) {
            let isDefaultExport = false;
            try {
                if (typeof (require(Path.resolve(apis[apiName])).default) === "function") {
                    isDefaultExport = true;
                }
            }
            catch (error) {
                throw new Error(`Could not find file ${Path.resolve(apis[apiName])} as found in: ${value}: ${error.message}: ${error.stack}`);
            }
            if (!isDefaultExport) {
                throw new Error(`The Api ${apis[apiName]} as found in: ${value}, must contain a default exported class extending ActionHandler.`);
            }
        }
    }
});
Config.addBoolConfig("VSERVER_METRICSDEFAULT", true);
Config.addBoolConfig("VSERVER_CACHING", true);
Config.addBoolConfig("VSERVER_TLS", false, (value, config) => {
    if (value) {
        if (config.VSERVER_KEYPATH === undefined || config.VSERVER_CERTPATH === undefined) {
            throw new Error("Invalid keypath or certpath, using tls but one of them is undefined.");
        }
        config.VSERVER_KEYPATH = Path.resolve(config.VSERVER_KEYPATH);
        config.VSERVER_CERTPATH = Path.resolve(config.VSERVER_CERTPATH);
        if (!FS.existsSync(config.VSERVER_CERTPATH)) {
            throw new Error(`Invalid keypath: Unable to find file ${config.VSERVER_KEYPATH}`);
        }
        if (!FS.existsSync(config.VSERVER_CERTPATH)) {
            throw new Error(`Invalid keypath: Unable to find file ${config.VSERVER_CERTPATH}`);
        }
    }
});
