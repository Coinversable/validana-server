/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import * as Cluster from "cluster";
import * as FS from "fs";
import * as Path from "path";
import { Log, Crypto } from "@coinversable/validana-core";

/** The config for the backend. Using all capitalized names because this is the standard for environment variables. */
export interface ConfigValues {
	VSERVER_DBUSER: string; //Database user
	VSERVER_DBPASSWORD: string | undefined; //Database password
	VSERVER_DBNAME: string; //Database name
	VSERVER_DBHOST: string; //Database host
	VSERVER_SENTRYURL: string | undefined; //The sentry url for error reporting (optional)
	VSERVER_LOGFORMAT: string | undefined; //Format used for logging
	VSERVER_API: string | undefined; //All api versions that this backend supports
	VSERVER_KEYPATH: string | undefined; //Certificate (in case you use no reverse proxy)
	VSERVER_CERTPATH: string | undefined; //Certificate (in case you use no reverse proxy)
	//The token that must be passed to request the metrics from the basics api.
	//If not provided (or METRICSINTERVAL is 0) it is not possible to request metrics from the basics api.
	//You can of course create a custom handler and implement your own access control instead.
	VSERVER_METRICSTOKEN: string | undefined;

	VSERVER_LOGLEVEL: number; //The log level we use.
	VSERVER_DBPORT: number; //Database port
	VSERVER_DBMINCONNECTIONS: number; //Minimum number of connections it should maintain to the database (per WORKER)
	VSERVER_DBMAXCONNECTIONS: number; //Maximum number of connections it may have to the database (per WORKER)
	VSERVER_MAXMEMORY: number; //How much memory is the handler allowed to use before we restart it.
	VSERVER_HTTPPORT: number; //Port to listen to connections to for http connections.
	VSERVER_WSPORT: number; //Ports to listen to connections to for ws connecions.
	VSERVER_TIMEOUT: number; //How long it waits between keep alive checks (in seconds)
	VSERVER_WORKERS: number; //How many workers do we want to have (0 or lower is all processing cores minus the number, 1+ is that many workers)
	VSERVER_MAXPAYLOADSIZE: number; //The maximum size (in bytes) a websocket/rest request may be before the server drops the connection. 0 = unlimited
	VSERVER_METRICSINTERVAL: number; //How often should it update the metrics. Defaults to 0 (off). Best set to scrape interval.

	VSERVER_TLS: boolean; //Whether to use tls or not
	VSERVER_CACHING: boolean; //Whether to use caching or not

	/** @deprecated Use the new VSERVER_HTTPPORT */
	VSERVER_RESTPORT: number; //Port to listen to connections to for http connections.
}

export interface ConfigValue {
	type: "string" | "boolean" | "number" | "object";
	defaultValue?: any;
	validator?: (input: any, config: { [key: string]: any }, key: string) => void;
}

/** A singleton config file. The first time Config.get() is called it will load the config and validate all values. */
export class Config {
	private static toLoadString = new Map<string, ConfigValue>();
	private static toLoadRegExp = new Map<RegExp, ConfigValue>();
	private static config: { [key: string]: any } = {};
	private static loadedConfig = false;

	public static get<T extends {} = {}>(): Readonly<ConfigValues & T> {
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
		return Config.config as Readonly<ConfigValues & T>;
	}

	/**
	 * Add a new variable to the config, for which it will check environment variables and config file.
	 * @param name The name of the variable, or a regular expression (which matches 0 or more variables)
	 * @param defaultValue Default value for the variable
	 * @param validator The validator. It should throw an error if it is not valid.
	 */
	public static addStringConfig<T extends {} = {}>(name: string, defaultValue: string,
		validator?: (input: string, config: ConfigValues & T, key: string) => void): typeof Config;
	public static addStringConfig<T extends {} = {}>(name: string, defaultValue?: undefined,
		validator?: (input: string | undefined, config: ConfigValues & T, key: string) => void): typeof Config;
	public static addStringConfig<T extends {} = {}>(name: RegExp,
		validator?: (input: string, config: ConfigValues & T, key: string) => void): typeof Config;
	// tslint:disable-next-line: ban-types
	public static addStringConfig(name: string | RegExp, defaultValue?: string | Function, validator?: Function): typeof Config {
		if (typeof defaultValue === "function") {
			validator = defaultValue;
			defaultValue = undefined;
		}
		if (typeof name === "string") {
			Config.toLoadString.set(name, { type: "string", defaultValue, validator: validator as any });
		} else {
			Config.toLoadRegExp.set(name, { type: "string", validator: validator as any });
		}
		return Config as typeof Config;
	}

	/**
	 * Add a new variable to the config, for which it will check environment variables and config file.
	 * @param name The name of the variable, or a regular expression (which matches 0 or more variables)
	 * @param defaultValue Default value for the variable
	 * @param validator The validator. It should throw an error if it is not valid.
	 */
	public static addNumberConfig<T extends {} = {}>(name: string, defaultValue: number,
		validator?: (input: number, config: ConfigValues & T, key: string) => void): typeof Config;
	public static addNumberConfig<T extends {} = {}>(name: string, defaultValue?: undefined,
		validator?: (input: number | undefined, config: ConfigValues & T, key: string) => void): typeof Config;
	public static addNumberConfig<T extends {} = {}>(name: RegExp,
		validator?: (input: number, config: ConfigValues & T, key: string) => void): typeof Config;
	// tslint:disable-next-line: ban-types
	public static addNumberConfig(name: string | RegExp, defaultValue?: number | Function, validator?: Function): typeof Config {
		if (typeof defaultValue === "function") {
			validator = defaultValue;
		}
		if (typeof name === "string") {
			Config.toLoadString.set(name, { type: "number", defaultValue, validator: validator as any });
		} else {
			Config.toLoadRegExp.set(name, { type: "number", validator: validator as any });
		}
		return Config as typeof Config;
	}

	/**
	 * Add a new variable to the config, for which it will check environment variables and config file.
	 * @param name The name of the variable, or a regular expression (which matches 0 or more variables)
	 * @param defaultValue Default value for the variable
	 * @param validator The validator. It should throw an error if it is not valid.
	 */
	public static addBoolConfig<T extends {} = {}>(name: string, defaultValue: boolean,
		validator?: (input: boolean, config: ConfigValues & T, key: string) => void): typeof Config;
	public static addBoolConfig<T extends {} = {}>(name: string, defaultValue?: undefined,
		validator?: (input: boolean | undefined, config: ConfigValues & T, key: string) => void): typeof Config;
	public static addBoolConfig<T extends {} = {}>(name: RegExp,
		validator?: (input: boolean, config: ConfigValues & T, key: string) => void): typeof Config;
	// tslint:disable-next-line: ban-types
	public static addBoolConfig(name: string | RegExp, defaultValue?: boolean | Function, validator?: Function): typeof Config {
		if (typeof defaultValue === "function") {
			validator = defaultValue;
		}
		if (typeof name === "string") {
			Config.toLoadString.set(name, { type: "boolean", defaultValue, validator: validator as any });
		} else {
			Config.toLoadRegExp.set(name, { type: "boolean", validator: validator as any });
		}
		return Config as typeof Config;
	}

	/**
	 * Add a new variable to the config, for which it will check environment variables and config file.
	 * @param name The name of the variable, or a regular expression (which matches 0 or more variables)
	 * @param defaultValue Default value for the variable
	 * @param validator The validator. It should throw an error if it is not valid.
	 */
	public static addObjectConfig<T extends {} = {}>(name: string, defaultValue: object,
		validator?: (input: object, config: ConfigValues & T, key: string) => void): typeof Config;
	public static addObjectConfig<T extends {} = {}>(name: string, defaultValue?: undefined,
		validator?: (input: boolean | undefined, config: ConfigValues & T, key: string) => void): typeof Config;
	public static addObjectConfig<T extends {} = {}>(name: RegExp,
		validator?: (input: object, config: ConfigValues & T, key: string) => void): typeof Config;
	// tslint:disable-next-line: ban-types
	public static addObjectConfig(name: string | RegExp, defaultValue?: object | Function, validator?: Function): typeof Config {
		if (typeof defaultValue === "function") {
			validator = defaultValue;
			defaultValue = undefined;
		}
		if (typeof name === "string") {
			Config.toLoadString.set(name, { type: "object", defaultValue, validator: validator as any });
		} else {
			Config.toLoadRegExp.set(name, { type: "object", validator: validator as any });
		}
		return Config as typeof Config;
	}

	/** Load all keys from the environment variables. */
	private static loadEnv(): void {
		//Load all values in the config value that we use.
		const newConfig: { [key: string]: any } = {};
		const regexps = Array.from(Config.toLoadRegExp.keys());
		for (const key of Object.keys(process.env)) {
			//Check if we need to load this type
			let type;
			if (Config.toLoadString.has(key)) {
				type = Config.toLoadString.get(key)!.type;
			} else {
				const matchingRegExp = regexps.find((regexp) => key.match(regexp) !== null);
				if (matchingRegExp !== undefined) {
					type = Config.toLoadRegExp.get(matchingRegExp)!.type;
				}
			}

			//If we need to load this (type is not undefined) parse it to the correct type if possible.
			if (type === "number") {
				newConfig[key] = Number.parseInt(process.env[key]!, 10);
			} else if (type === "boolean") {
				if (process.env[key] !== "true" && process.env[key] !== "false") {
					throw new Error(`Invalid environment value for key: ${key}, expected a boolean.`);
				}
				newConfig[key] = process.env[key] === "true";
			} else if (type === "object") {
				try {
					newConfig[key] = JSON.parse(process.env[key]!);
				} catch (error) {
					throw new Error(`Invalid environment value for key: ${key}, expected an object.`);
				}
			} else if (type === "string") {
				newConfig[key] = process.env[key];
			}
		}
		Object.assign(Config.config, newConfig);
	}

	/** Load all keys from the config file. */
	private static loadFile(): void {
		//arg 0 is node.exe, arg 1 is this script.js, arg2+ are the passed arguments
		if (process.argv.length >= 3) {
			//Determine where the config file should be and if it exists.
			const configPath = Path.resolve(process.argv[process.argv.length - 1]);
			if (!FS.existsSync(configPath)) {
				throw new Error(`Unable to find file: ${configPath}.`);
			}

			//Load config file.
			let configFile: { [key: string]: any };
			try {
				configFile = JSON.parse(Crypto.binaryToUtf8(FS.readFileSync(configPath)));
			} catch (error) {
				throw new Error(`Unable to load config file: ${configPath}: ${(error as Error).stack}.`);
			}
			if (typeof configFile !== "object" || configFile === null) {
				throw new Error(`Invalid config file.`);
			}

			//Load all values in the config value that we use.
			const newConfig: { [key: string]: any } = {};
			const regexps = Array.from(Config.toLoadRegExp.keys());
			for (const key of Object.keys(configFile)) {
				if (Config.toLoadString.has(key)) {
					newConfig[key] = configFile[key];
				} else if (regexps.find((regexp) => key.match(regexp) !== null) !== undefined) {
					newConfig[key] = configFile[key];
				} else {
					Log.warn(`Unknown config file key: ${key}`);
				}
			}
			Object.assign(Config.config, newConfig);
		}
	}

	/** Load all default values. */
	private static loadDefaults(): void {
		for (const toLoad of Config.toLoadString.keys()) {
			if (Config.config[toLoad] === undefined && Config.toLoadString.get(toLoad)!.defaultValue !== undefined) {
				Config.config[toLoad] = Config.toLoadString.get(toLoad)!.defaultValue;
			}
		}
	}

	/** Validate if all values are correct. */
	private static validate(): void {
		//Validate all exact names
		for (const key of Config.toLoadString.keys()) {
			const toLoad = Config.toLoadString.get(key)!;
			//If this key exists it must be of the correct type.
			if (Config.config[key] !== undefined && (typeof Config.config[key] !== toLoad.type ||
				Config.config[key] === null || toLoad.type === "number" && !Number.isSafeInteger(Config.config[key]))) {
				throw new Error(`Invalid value for key: ${key}, expected a ${toLoad.type}.`);
			}
			//Regardless of whether it exists it must pass the validator, which may or may not allow undefined
			toLoad.validator?.(Config.config[key], Config.config, key);
		}
		//Validate all reg exp names.
		for (const key of Object.keys(Config.config)) {
			for (const regExp of Config.toLoadRegExp.keys()) {
				if (key.match(regExp) !== null) {
					const toLoad = Config.toLoadRegExp.get(regExp)!;
					//If it matches it must be of the correct type.
					if (typeof Config.config[key] !== toLoad.type || Config.config[key] === null
						|| toLoad.type === "number" && !Number.isSafeInteger(Config.config[key])) {
						throw new Error(`Invalid value for key: ${key}, expected a ${toLoad.type}.`);
					}
					//If it also has a validator it must pass the validator.
					toLoad.validator?.(Config.config[key], Config.config, key);
				}
			}
		}
	}
}

//Add all standard keys to the config.
Config.addNumberConfig("VSERVER_LOGLEVEL", 0, (value) => {
	if (value < Log.Debug || value > Log.None) {
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
			Log.warn("VSERVER_RESTPORT is depricated, use VSERVER_HTTPPORT");
			config.VSERVER_HTTPPORT = config.VSERVER_RESTPORT;
		} else {
			config.VSERVER_HTTPPORT = 8080;
			config.VSERVER_RESTPORT = 8080;
		}
	} else {
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
		} catch (error) {
			throw new Error(`Invalid api: ${value}: ${(error as Error).message}: ${(error as Error).stack}`);
		}
		for (const apiName of Object.keys(apis)) {
			let isDefaultExport = false;
			try {
				if (typeof (require(Path.resolve(apis[apiName])).default) === "function") {
					isDefaultExport = true;
				}
			} catch (error) {
				throw new Error(`Could not find file ${Path.resolve(apis[apiName])} as found in: ${value}: ${(error as Error).message}: ${(error as Error).stack}`);
			}
			if (!isDefaultExport) {
				throw new Error(`The Api ${apis[apiName]} as found in: ${value}, must contain a default exported class extending ActionHandler.`);
			}
		}
	}
});
Config.addBoolConfig("VSERVER_METRICSDEFAULT", true);
Config.addBoolConfig("VSERVER_CACHING", true);
Config.addBoolConfig("VSERVER_TLS", true, (value, config) => {
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