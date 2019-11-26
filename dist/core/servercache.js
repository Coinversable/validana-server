"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const validana_core_1 = require("@coinversable/validana-core");
const config_1 = require("../config");
class ServerCache {
    constructor(clearCacheFrequency = 3600) {
        this.cachedData = new Map();
        if (clearCacheFrequency >= 1) {
            setInterval(() => this.deleteExpired(), clearCacheFrequency * 1000);
        }
    }
    static create(name, clearCacheFrequency = 3600) {
        if (!this.createdCaches.has(name)) {
            this.createdCaches.set(name, new ServerCache(clearCacheFrequency));
        }
        return this.createdCaches.get(name);
    }
    static has(key) {
        return ServerCache.cachedData.has(key);
    }
    static add(key, update, duration = 300) {
        if (!ServerCache.cachedData.has(key)) {
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
        if (cachedData === undefined) {
            throw new Error(`Key ${key} is not cached.`);
        }
        if (newValue === undefined) {
            cachedData.lastUpdate = 0;
        }
        else {
            cachedData.value = newValue;
            cachedData.lastUpdate = Date.now();
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
    add(key, update, duration = 300) {
        if (!this.cachedData.has(key)) {
            this.cachedData.set(key, { value: undefined, update, duration: duration * 1000, lastUpdate: 0 });
        }
    }
    addAll(update, duration = 300) {
        this.updateAllMethod = update;
        this.updateAllDuration = duration;
    }
    async get(key) {
        if (!this.has(key) && this.updateAllMethod !== undefined) {
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
                validana_core_1.Log.warn(`Failed to update cache for key ${key}`, error);
                throw new Error("Failed to update cache.");
            }
        }
        return cachedData.value;
    }
    invalidate(key, newValue) {
        const cachedData = this.cachedData.get(key);
        if (cachedData === undefined) {
            throw new Error(`Key ${key} is not cached.`);
        }
        if (newValue === undefined) {
            cachedData.lastUpdate = 0;
        }
        else {
            cachedData.value = newValue;
            cachedData.lastUpdate = Date.now();
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
