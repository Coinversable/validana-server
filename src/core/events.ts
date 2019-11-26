import { Log } from "@coinversable/validana-core";
import { DBTransaction } from "./database";
import { Message } from "../protocol/protocol";
import { Socket } from "net";
import * as WebSocket from "ws";

/**
 * The server event emitter can be used for a publish-subscriber pattern.
 * You can eighter subscribe to a type of messages, or a specific subtype to easily
 *  filter on what messages you want to receive.
 * When subscribing because of a received message it will automatically unsubscribe should the connection close.
 */
export class ServerEventEmitter<T = any> {
	private static readonly instances = new Map<string, ServerEventEmitter>();

	private readonly subtypeToConnection = new Map<string | undefined, Array<[Socket | WebSocket | undefined, (data: any) => void]>>();

	private constructor() { }

	/** Get an event emitter for a transactions. */
	public static get(eventType: "transactionId" | "transactionAddress" | "transactionContract" | "transaction"): ServerEventEmitter<DBTransaction>;
	/** Get an event emitter for a certain type of events. */
	public static get(eventType: string): ServerEventEmitter;
	public static get(eventType: string): ServerEventEmitter {
		let instance = this.instances.get(eventType);
		if (instance === undefined) {
			instance = new ServerEventEmitter();
			this.instances.set(eventType, instance);
		}
		return instance;
	}

	/**
	 * Unsubscribe a connection from updates. This is done automatically once the connection is closed.
	 * Should not be called inside a subscriber.
	 * @param message The message that was received for which you want to unsubscribe (or undefined to remove all general subscribers).
	 * @param subtype The subtype to remove the connection from.
	 */
	public unsubscribe(message: Message | undefined, subtype?: string): void {
		const connection = message === undefined ? undefined : message.response instanceof WebSocket ? message.response : message.response.connection;
		const connections = this.subtypeToConnection.get(subtype);
		if (connections !== undefined) {
			const newConnections = connections.filter((conn) => conn[0] !== connection);
			if (newConnections.length === 0) {
				this.subtypeToConnection.delete(subtype);
			} else {
				this.subtypeToConnection.set(subtype, newConnections);
			}
		}
	}

	/**
	 * Subscribe an connection for updates. The connection will automatically unsubscribe upon being closed.
	 * @param message The message that was received for which you want to subscribe (or undefined for a general subscriber).
	 * @param subscriber The function that should be called when there is an update.
	 * @param subtype The subtype to subscribe for. If this type of event emitter doesn't have subtype leave it empty.
	 */
	public subscribe(message: Message | undefined, subscriber: (data: T) => void, subtype?: string): void {
		const connection = message === undefined ? undefined : message.response instanceof WebSocket ? message.response : message.response.connection;
		const connections = this.subtypeToConnection.get(subtype);
		if (connections === undefined) {
			this.subtypeToConnection.set(subtype, [[connection, subscriber]]);
		} else {
			connections.push([connection, subscriber]);
		}

		//Make sure it is removed again if the connection is closed:
		connection?.on("close", () => this.unsubscribe(message, subtype));
	}

	/** Emit an event (for a certain subtype). */
	public emit(data: T, subtype?: string): void {
		const connections = this.subtypeToConnection.get(subtype);
		if (connections !== undefined) {
			for (const connection of connections) {
				connection[1].call(connection[0], data);
			}
		}
	}

	/** Check if there is a subscription for a certain message or a certain subscriber. */
	public isSubscribed(messageOrSubscriber: Message | ((data: T) => void), subtype?: string): boolean {
		const connections = this.subtypeToConnection.get(subtype);
		if (typeof messageOrSubscriber === "function") {
			return connections !== undefined && connections.some((connection) => connection[1] === messageOrSubscriber);
		} else {
			const thisConnection = messageOrSubscriber.response instanceof WebSocket ? messageOrSubscriber.response : messageOrSubscriber.response.connection;
			return connections !== undefined && connections.some((connection) => connection[0] === thisConnection);
		}
	}

	/** Returns if there are any subscribers for this event type (and subtype). */
	public hasSubscribers(subtype?: string): boolean {
		if (subtype === undefined) {
			return this.subtypeToConnection.size > 0;
		} else {
			return this.subtypeToConnection.get(subtype) !== undefined;
		}
	}

	/** Returns the number of subscribers (for a subtype). */
	public getSubscribersSize(subtype?: string): number {
		if (subtype === undefined) {
			let total = 0;
			for (const subscribers of this.subtypeToConnection.values()) {
				total += subscribers.length;
			}
			return total;
		} else {
			return this.subtypeToConnection.get(subtype)?.length ?? 0;
		}
	}

	/** Returns the number of subtypes with at least one subscriber. */
	public getSubtypesSize(): number {
		return this.subtypeToConnection.size;
	}

	/** Returns a list of subtypes with at least one subscriber. */
	public getSubtypes(): IterableIterator<string | undefined> {
		return this.subtypeToConnection.keys();
	}
}

/** Create a generator for periodic events. Will take care of error handling and heavy load. */
export class ServerEventGenerator {
	private failures: number = 0;
	private running: number = 0;
	private frequency: number;
	private interval: NodeJS.Timeout;

	/**
	 * Create a new event generator that will perform an action every interval.
	 * @param action The action to perform
	 * @param frequency The frequency (in milliseconds)
	 */
	constructor(action: () => void, frequency: number) {
		this.frequency = frequency;
		//Run once, then every interval
		setTimeout(() => this.run(action), 0);
		this.interval = setInterval(() => this.run(action), frequency);
	}

	public async run(action: () => void): Promise<void> {
		if (this.running !== 0) {
			Log.warn(`Backend under heavy load, was still running ${this.running} times in a row.`);
			if (this.running > 3 && this.frequency * this.running > 30000) { //Fail at least 3 times and 30 seconds long
				Log.error(`Backend under heavy load, was still running many times in a row.`);
			}
			this.running++;
			return;
		}
		try {
			this.running++;
			await action();
			this.failures = 0;
			this.running = 0;
		} catch (error) {
			this.failures++;
			Log.warn(`Event generator caused an error ${this.failures} times in a row.`, error);
			if (this.failures > 3 && this.frequency * this.running > 30000) { //Fail at least 3 times and 30 seconds long
				Log.error(`Event generator caused an error many times in a row.`, error);
			}
			this.running = 0;
		}
	}

	public stop(): void {
		clearInterval(this.interval);
	}
}