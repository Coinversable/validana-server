/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import { Log } from "@coinversable/validana-core";
import { QueryResult, QueryConfig, types, Pool, PoolConfig, PoolClient, Client } from "pg";
import { EventEmitter } from "events";

//Parser for bigint (array) types, which by default is a string (due to information loss with numbers).
types.setTypeParser(20, (val: string) => Number.parseInt(val, 10));
types.setTypeParser(1016, (val: string) => val.length === 2 ? [] : val.slice(1, -1).split(",").map((v) => Number.parseInt(v, 10)));

/**
 * The database class is responsible for interacting with the blockchain and updating subscribers.
 * It is also suitable for connecting with other postgres databases, making use of a connection pool.
 *
 * Use Database.get( name ) to create a new connection pool or get an existing one with that name.
 * The first time before it can be used setup should be called.
 */
export class Database extends EventEmitter {
	//All databases
	private static instance = new Map<string | undefined, Database>();

	protected dbSetup: PoolConfig | undefined;
	protected pool: Pool | undefined;
	protected name: string | undefined;
	protected dedicatedConnections: Client[] = [];

	protected constructor(name: string | undefined) {
		super();
		this.name = name;
	}

	/**
	 * Get a database to connect to. You must call setup() before you can query it.
	 * @param name To get a specific database. Defaults to the database setup in the config.
	 */
	public static get(name?: string): Database {
		if (!Database.instance.has(name)) {
			Database.instance.set(name, new Database(name));
		}
		return Database.instance.get(name)!;
	}

	/** Setup the database. This must be done before you can query it. */
	public setup(setup: PoolConfig): void {
		if (this.dbSetup === undefined) {
			this.dbSetup = setup;
			this.pool = new Pool(this.dbSetup).on("error", (error) => {
				if (this.dbSetup!.password !== undefined) {
					error.message = error.message.replace(new RegExp(this.dbSetup!.password, "g"), "");
				}
				Log.warn("Problem with database connection.", error);
			});
		}
		this.emit("setup");
	}

	/** Is the database already setup or not? You can subscribe to the setup event to be notified when it is being setup. */
	public isSetup(): boolean {
		return this.dbSetup !== undefined;
	}

	/** Check if the database is active. (Is setup and not shutdown.) */
	public isActive(): boolean {
		return this.pool !== undefined;
	}

	/** Shutdown the database connection. */
	public async shutdown(): Promise<void> {
		if (this.pool === undefined) {
			return Promise.resolve();
		}
		this.emit("destroy");
		await Promise.all([
			this.pool.end().catch((error) => Log.warn("Failed to close database connection.", error)),
			...this.dedicatedConnections.map((connection) => connection.end())
		]);
		Database.instance.delete(this.name);
	}

	/** Shutdown all database connections. */
	public static async shutdownAll(): Promise<void[]> {
		const promises: Array<Promise<void>> = [];
		for (const db of Database.instance.values()) {
			promises.push(db.shutdown());
		}
		return Promise.all(promises);
	}

	/**
	 * Query the database. Will connect to the database if it is not currently connected.
	 * Note that it will execute queries using multiple connections. To ensure you use
	 *  the same connection (for example for a begin-commit query) or getConnection() instead.
	 * @param query The query to execute
	 * @param values The values to use
	 */
	public async query(query: QueryConfig | string, values?: any[]): Promise<QueryResult> {
		if (this.pool === undefined) {
			return Promise.reject(new Error("Database must be setup and active before you can query it."));
		}
		return this.pool.query(query, values);
	}

	/**
	 * Get a single database connection from the pool. Allows for executing multiple queries using the same connection.
	 * Connection must be released after finishing to give it back to the pool.
	 * Recommended use: getConnection() try{begin,commit} catch{rollback} finally{release}.
	 */
	public async getConnection(): Promise<PoolClient> {
		if (this.pool === undefined) {
			return Promise.reject(new Error("Database must be setup and active before you can query it."));
		}
		return await this.pool.connect();
	}

	/**
	 * Create a new database connection, seperate from the pool.
	 * Allows for long connections without disrupting others.
	 * You must manually call connect() and end() (though it will be closed if this database is shutdown).
	 */
	public getDedicatedConnection(): Client {
		if (this.pool === undefined) {
			throw new Error("Database must be setup and active before you can query it.");
		}
		const client = new Client(this.dbSetup).on("error", (error) => {
			if (this.dbSetup!.password !== undefined) {
				error.message = error.message.replace(new RegExp(this.dbSetup!.password, "g"), "");
			}
			Log.warn("Problem with database connection.", error);
		});
		this.dedicatedConnections.push(client);
		client.on("end", () => this.dedicatedConnections.splice(this.dedicatedConnections.indexOf(client), 1));
		return client;
	}

	/**
	 * Use to ensure a (table/column) name is safe from sql injections. Only allows a-z, A-Z, digits and underscores.
	 * @param name the name to ensure it is safe
	 * @returns the name if it is safe
	 * @throws if the name is not safe
	 */
	public static safeName(name: string): string {
		if (typeof name === "string" && name.match(/^[a-zA-Z_]\w+$/) === null) {
			throw new Error(`Name may not contain special characters: ${name}`);
		}
		return name;
	}

	public on(event: "setup", listener: () => void): this;
	public on(event: "destroy", listener: () => void): this;
	public on(event: string | symbol, listener: (...args: any[]) => void): this;
	public on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}
}

/** Transaction as found in the database. */
export interface DBTransaction {
	//Unprocessed transaction info
	transaction_id: Buffer;
	version: number;
	contract_hash: Buffer;
	valid_till: number;
	payload: any; //Additional contract specific info
	public_key: Buffer;
	signature: Buffer;
	create_ts?: number; //Only if is processor
	status: TransactionStatus; //Will change once processed

	//Processed transaction info
	sender: string | null;
	contract_type: string | null;
	message: string | null;
	block_id: number | null;
	position_in_block: number | null;
	processed_ts: number | null;

	//Additional transaction info
	receiver: string | null;
}

/** Status of transaction found in the database. */
export enum TransactionStatus {
	New = "new", Invalid = "invalid", Accepted = "accepted", Rejected = "rejected"
}