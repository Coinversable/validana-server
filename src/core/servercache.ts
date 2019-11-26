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
	private cachedData = new Map<string, { value: T, update: (key: string) => Promise<T>, duration: number, lastUpdate: number }>();
	private updateAllMethod: ((key: string) => Promise<T>) | undefined;
	private updateAllDuration: number | undefined;

	private constructor(clearCacheFrequency: number = 3600) {
		if (clearCacheFrequency >= 1) {
			setInterval(() => this.deleteExpired(), clearCacheFrequency * 1000);
		}
	}

	/**
	 * Create a new server cache or return an existing one with its name.
	 * @param name The name of the cache.
	 * @param clearCacheFrequency How frequently it should clear caches in seconds. Use 0 for never, default is once per hour.
	 */
	public static create<T>(name: string, clearCacheFrequency: number = 3600): ServerCache<T> {
		if (!this.createdCaches.has(name)) {
			this.createdCaches.set(name, new ServerCache<T>(clearCacheFrequency));
		}

		return this.createdCaches.get(name)!;
	}

	/** Check if a key exists in the global cache. */
	public static has(key: string): boolean {
		return ServerCache.cachedData.has(key);
	}

	/** Add a new key to the global cache, how to update this key and the duraction that this value remains valid in seconds. */
	public static add(key: string, update: (key: string) => Promise<any>, duration: number = 300): void {
		if (!ServerCache.cachedData.has(key)) {
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

	/** Invalidate the global cache (or update the cache manually). Can be used to force the cache to update. */
	public static invalidate(key: string, newValue?: any): void {
		const cachedData = ServerCache.cachedData.get(key);
		if (cachedData === undefined) {
			throw new Error(`Key ${key} is not cached.`);
		}
		if (newValue === undefined) {
			cachedData.lastUpdate = 0;
		} else {
			cachedData.value = newValue;
			cachedData.lastUpdate = Date.now();
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
	public add(key: string, update: (key: string) => Promise<T>, duration: number = 300): void {
		if (!this.cachedData.has(key)) {
			this.cachedData.set(key, { value: undefined as any, update, duration: duration * 1000, lastUpdate: 0 });
		}
	}

	/** Add a method to add alls keys, how to update those keys and the duration that these values remain values in seconds. */
	public addAll(update: (key: string) => Promise<T>, duration: number = 300): void {
		this.updateAllMethod = update;
		this.updateAllDuration = duration;
	}

	/** Get data from the non-global cache.Will reject if the cache is outdated and fails to update. */
	public async get(key: string): Promise<T> {
		if (!this.has(key) && this.updateAllMethod !== undefined) {
			this.add(key, this.updateAllMethod, this.updateAllDuration);
		}
		const cachedData = this.cachedData.get(key);
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

	/** Invalidate the non-global cache (or update the cache manually). Can be used to force the cache to update. */
	public invalidate(key: string, newValue?: T): void {
		const cachedData = this.cachedData.get(key);
		if (cachedData === undefined) {
			throw new Error(`Key ${key} is not cached.`);
		}
		if (newValue === undefined) {
			cachedData.lastUpdate = 0;
		} else {
			cachedData.value = newValue;
			cachedData.lastUpdate = Date.now();
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