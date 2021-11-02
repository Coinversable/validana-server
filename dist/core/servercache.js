"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerCache = void 0;
const validana_core_1 = require("@coinversable/validana-core");
const config_1 = require("../config");
class ServerCache {
    constructor(name, clearCacheFrequency = 3600) {
        this.cachedData = new Map();
        this.name = name;
        if (clearCacheFrequency >= 1) {
            setTimeout(() => {
                this.deleteExpired();
                setInterval(() => this.deleteExpired(), clearCacheFrequency * 1000);
            }, Math.random() * clearCacheFrequency * 1000);
        }
    }
    static create(name, clearCacheFrequency = 3600) {
        if (!this.createdCaches.has(name)) {
            this.createdCaches.set(name, new ServerCache(name, clearCacheFrequency));
        }
        return this.createdCaches.get(name);
    }
    static has(key) {
        return ServerCache.cachedData.has(key);
    }
    static add(key, update, duration = 300, override = false) {
        if (!ServerCache.cachedData.has(key) || override) {
            ServerCache.cachedData.set(key, { value: undefined, update, duration: duration * 1000, lastUpdate: 0 });
        }
    }
    static async get(key) {
        const cachedData = ServerCache.cachedData.get(key);
        if (cachedData === undefined) {
            throw new Error(`Key ${key} is not cached.`);
        }
        if (Date.now() > cachedData.lastUpdate + cachedData.duration || !config_1.Config.get().VSERVER_CACHING) {
            try {
                cachedData.value = await cachedData.update(key);
                cachedData.lastUpdate = Date.now();
            }
            catch (error) {
                validana_core_1.Log.warn(`Failed to update cache for key ${key}`, error);
                throw new Error("Failed to update cache.");
            }
        }
        return cachedData.value;
    }
    static invalidate(key, newValue) {
        const cachedData = ServerCache.cachedData.get(key);
        if (cachedData !== undefined) {
            if (newValue === undefined) {
                cachedData.lastUpdate = 0;
            }
            else {
                cachedData.value = newValue;
                cachedData.lastUpdate = Date.now();
            }
        }
    }
    static invalidateAll() {
        for (const cachedData of ServerCache.cachedData.values()) {
            cachedData.lastUpdate = 0;
        }
    }
    static delete(key) {
        this.cachedData.delete(key);
    }
    has(key) {
        return this.cachedData.has(key);
    }
    add(key, update, duration = 300, override = false) {
        if (!this.cachedData.has(key) || override) {
            this.cachedData.set(key, { value: undefined, update, duration: duration * 1000, lastUpdate: 0 });
        }
    }
    addAll(update, duration = 300, override = false) {
        if (this.updateAllMethod === undefined || override) {
            this.updateAllMethod = update;
            this.updateAllDuration = duration;
        }
    }
    async get(key) {
        if (!this.cachedData.has(key) && this.updateAllMethod !== undefined) {
            this.add(key, this.updateAllMethod, this.updateAllDuration);
        }
        const cachedData = this.cachedData.get(key);
        if (cachedData === undefined) {
            throw new Error(`Key ${key} is not cached.`);
        }
        if (Date.now() > cachedData.lastUpdate + cachedData.duration || !config_1.Config.get().VSERVER_CACHING) {
            try {
                cachedData.value = await cachedData.update(key);
                cachedData.lastUpdate = Date.now();
            }
            catch (error) {
                validana_core_1.Log.warn(`Failed to update cache ${this.name} for key ${key}`, error);
                throw new Error("Failed to update cache.");
            }
        }
        return cachedData.value;
    }
    async getMultiple(keys) {
        if (this.updateAllMethod === undefined) {
            validana_core_1.Log.error("An update all method that accepts an array is required for ServerCache.getMultiple().", new Error());
            throw new Error("Invalid cache usage.");
        }
        const result = new Array(keys.length);
        const now = Date.now();
        let uncachedKeys;
        if (config_1.Config.get().VSERVER_CACHING) {
            uncachedKeys = [];
            for (let i = 0; i < keys.length; i++) {
                const cachedData = this.cachedData.get(keys[i]);
                if (cachedData === undefined || cachedData.value === undefined || now > cachedData.lastUpdate + cachedData.duration) {
                    uncachedKeys.push(keys[i]);
                }
                else {
                    result[i] = cachedData.value;
                }
            }
        }
        else {
            uncachedKeys = keys;
        }
        if (uncachedKeys.length !== 0) {
            let toCache;
            try {
                toCache = await this.updateAllMethod(uncachedKeys);
            }
            catch (error) {
                validana_core_1.Log.warn(`Failed to update cache ${this.name} for keys ${uncachedKeys.toString()}`, error);
                throw new Error("Failed to update cache.");
            }
            let j = 0;
            for (let i = 0; i < result.length; i++) {
                if (result[i] === undefined) {
                    this.cachedData.set(uncachedKeys[j], { value: toCache[j], update: this.updateAllMethod, duration: this.updateAllDuration * 1000, lastUpdate: now });
                    result[i] = toCache[j];
                    j++;
                }
            }
        }
        return result;
    }
    invalidate(key, newValue) {
        const cachedData = this.cachedData.get(key);
        if (cachedData !== undefined) {
            if (newValue === undefined) {
                cachedData.lastUpdate = 0;
            }
            else {
                cachedData.value = newValue;
                cachedData.lastUpdate = Date.now();
            }
        }
    }
    invalidateAll() {
        for (const cachedData of this.cachedData.values()) {
            cachedData.lastUpdate = 0;
        }
    }
    delete(key) {
        this.cachedData.delete(key);
    }
    deleteAll() {
        this.cachedData.clear();
        this.updateAllMethod = undefined;
    }
    deleteExpired() {
        const now = Date.now();
        for (const key of this.cachedData.keys()) {
            const cachedData = this.cachedData.get(key);
            if (cachedData.lastUpdate + cachedData.duration < now) {
                this.cachedData.delete(key);
            }
        }
    }
}
exports.ServerCache = ServerCache;
ServerCache.cachedData = new Map();
ServerCache.createdCaches = new Map();
