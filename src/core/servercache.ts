import { Log } from "@coinversable/validana-core";
import { Config } from "../config";

/**
 * The server cache class is serves as a cache.
 * It comes with instructions on how to update the cache and how long the cache is valid.
 * The static version contains the global cache, but a non-global cache can also be created.
 * It is called ServerCache to avoid naming conflic with the Node Cache.
 */
export class ServerCache<T = any> {
	/** Global cache. */
	private static cachedData = new Map<string, { value: any, update: (key: string) => Promise<any>, duration: number, lastUpdate: number }>();
	/** List of created caches. */
	private static createdCaches = new Map<string, ServerCache>();
	/** Non-global cache. */
	private cachedData = new Map<string, { value: T, update: (key: string | string[]) => Promise<T | T[]>, duration: number, lastUpdate: number }>();
	private updateAllMethod: ((key: string | string[]) => Promise<T | T[]>) | undefined;
	private updateAllDuration: number | undefined;
	private name: string;

	private constructor(name: string, clearCacheFrequency: number = 3600) {
		this.name = name;
		if (clearCacheFrequency >= 1) {
			setTimeout(() => {
				this.deleteExpired();
				setInterval(() => this.deleteExpired(), clearCacheFrequency * 1000);
			}, Math.random() * clearCacheFrequency * 1000);
		}
	}

	/**
	 * Create a new server cache or return an existing one with its name.
	 * @param name The name of the cache.
	 * @param clearCacheFrequency How frequently it should clear caches in seconds. Use 0 for never, default is once per hour.
	 */
	public static create<R>(name: string, clearCacheFrequency: number = 3600): ServerCache<R> {
		if (!this.createdCaches.has(name)) {
			this.createdCaches.set(name, new ServerCache<R>(name, clearCacheFrequency));
		}

		return this.createdCaches.get(name)!;
	}

	/** Check if a key exists in the global cache. */
	public static has(key: string): boolean {
		return ServerCache.cachedData.has(key);
	}

	/** Add a new key to the global cache, how to update this key and the duraction that this value remains valid in seconds. */
	public static add(key: string, update: (key: string) => Promise<any>,
		duration: number = 300, override: boolean = false): void {
		if (!ServerCache.cachedData.has(key) || override) {
			ServerCache.cachedData.set(key, { value: undefined, update, duration: duration * 1000, lastUpdate: 0 });
		}
	}

	/** Get data from the global cache. Will reject if the cache is outdated and fails to update. */
	public static async get(key: string): Promise<any> {
		const cachedData = ServerCache.cachedData.get(key);
		if (cachedData === undefined) {
			throw new Error(`Key ${key} is not cached.`);
		}
		if (Date.now() > cachedData.lastUpdate + cachedData.duration || !Config.get().VSERVER_CACHING) {
			try {
				cachedData.value = await cachedData.update(key);
				cachedData.lastUpdate = Date.now();
			} catch (error) {
				Log.warn(`Failed to update cache for key ${key}`, error);
				throw new Error("Failed to update cache.");
			}
		}
		return cachedData.value;
	}

	/**
	 * Invalidate the global cache (or update the cache manually).
	 * Can be used to force the cache to update.
	 * Ignores the update if key is not cached.
	 */
	public static invalidate(key: string, newValue?: any): void {
		const cachedData = ServerCache.cachedData.get(key);
		if (cachedData !== undefined) {
			if (newValue === undefined) {
				cachedData.lastUpdate = 0;
			} else {
				cachedData.value = newValue;
				cachedData.lastUpdate = Date.now();
			}
		}
	}

	/** Invalidate the whole global cache, forcing everything to update. */
	public static invalidateAll(): void {
		for (const cachedData of ServerCache.cachedData.values()) {
			cachedData.lastUpdate = 0;
		}
	}

	//We do not allow deleteAll or deleteExpired for global.
	/** Delete a key from the global cache. */
	public static delete(key: string): void {
		this.cachedData.delete(key);
	}

	/** Check if a key exists in the non-global cache. */
	public has(key: string): boolean {
		return this.cachedData.has(key);
	}

	/** Add a new key to the non-global cache, how to update this key and the duration that this value remains valid in seconds. */
	public add(key: string, update: (key: string | string[]) => Promise<T | T[]>,
		duration: number = 300, override: boolean = false): void {
		if (!this.cachedData.has(key) || override) {
			this.cachedData.set(key, { value: undefined as any, update, duration: duration * 1000, lastUpdate: 0 });
		}
	}


	/**
	 * Add a method to add alls keys, how to update those keys and the duration that these values remain values in seconds.
	 * To support getMultiple() the update method needs to be able to deal with both single keys
	 *  and arrays and return the result in the same format and order as requested.
	 */
	public addAll(update: ((keys: string | string[]) => Promise<T | T[]>) | ((keys: string) => Promise<T>),
		duration: number = 300, override: boolean = false): void {
		if (this.updateAllMethod === undefined || override) {
			this.updateAllMethod = update;
			this.updateAllDuration = duration;
		}
	}

	/** Get data from the non-global cache.Will reject if the cache is outdated and fails to update. */
	public async get(key: string): Promise<T> {
		if (!this.cachedData.has(key) && this.updateAllMethod !== undefined) {
			this.add(key, this.updateAllMethod as any, this.updateAllDuration);
		}
		const cachedData = this.cachedData.get(key);
		if (cachedData === undefined) {
			throw new Error(`Key ${key} is not cached.`);
		}
		if (Date.now() > cachedData.lastUpdate + cachedData.duration || !Config.get().VSERVER_CACHING) {
			try {
				cachedData.value = await cachedData.update(key) as T;
				cachedData.lastUpdate = Date.now();
			} catch (error) {
				Log.warn(`Failed to update cache ${this.name} for key ${key}`, error);
				throw new Error("Failed to update cache.");
			}
		}
		return cachedData.value;
	}

	/**
	 * Get multiple values at once, returned in same order as the keys array.
	 * Requires an addAll method that accepts an array of keys used to retrieve missing/outdated records.
	 */
	public async getMultiple(keys: string[]): Promise<T[]> {
		if (this.updateAllMethod === undefined) {
			Log.error("An update all method that accepts an array is required for ServerCache.getMultiple().", new Error());
			throw new Error("Invalid cache usage.");
		}
		//Get all keys that are already cached.
		const result = new Array(keys.length);
		const now = Date.now();
		let uncachedKeys;
		if (Config.get().VSERVER_CACHING) {
			uncachedKeys = [];
			for (let i = 0; i < keys.length; i++) {
				const cachedData = this.cachedData.get(keys[i]);
				if (cachedData === undefined || cachedData.value === undefined || now > cachedData.lastUpdate + cachedData.duration) {
					uncachedKeys.push(keys[i]);
				} else {
					result[i] = cachedData.value;
				}
			}
		} else {
			uncachedKeys = keys;
		}
		if (uncachedKeys.length !== 0) {
			//Get all keys which are not yet cached
			let toCache;
			try {
				toCache = await this.updateAllMethod(uncachedKeys) as T[];
			} catch (error) {
				Log.warn(`Failed to update cache ${this.name} for keys ${uncachedKeys.toString()}`, error);
				throw new Error("Failed to update cache.");
			}
			//Fill in result and cache the keys
			let j = 0;
			for (let i = 0; i < result.length; i++) {
				if (result[i] === undefined) {
					this.cachedData.set(uncachedKeys[j], { value: toCache[j], update: this.updateAllMethod, duration: this.updateAllDuration! * 1000, lastUpdate: now });
					result[i] = toCache[j];
					j++;
				}
			}
		}

		return result;
	}

	/**
	 * Invalidate the non-global cache (or update the cache manually).
	 * Can be used to force the cache to update.
	 * Ignores the update if key is not cached.
	 */
	public invalidate(key: string, newValue?: T): void {
		const cachedData = this.cachedData.get(key);
		if (cachedData !== undefined) {
			if (newValue === undefined) {
				cachedData.lastUpdate = 0;
			} else {
				cachedData.value = newValue;
				cachedData.lastUpdate = Date.now();
			}
		}
	}

	/** Invalidate the whole non-global cache, forcing everything to update. */
	public invalidateAll(): void {
		for (const cachedData of this.cachedData.values()) {
			cachedData.lastUpdate = 0;
		}
	}

	/** Delete a key from the non-global cache. */
	public delete(key: string): void {
		this.cachedData.delete(key);
	}

	/** Delete all keys from the non-global cache. */
	public deleteAll(): void {
		this.cachedData.clear();
		this.updateAllMethod = undefined;
	}

	/** Delete all expired keys from the non-global cache. */
	public deleteExpired(): void {
		const now = Date.now();
		for (const key of this.cachedData.keys()) {
			const cachedData = this.cachedData.get(key)!;
			if (cachedData.lastUpdate + cachedData.duration < now) {
				this.cachedData.delete(key);
			}
		}
	}
}