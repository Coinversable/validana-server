/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import { EventEmitter } from "events";
import { Message } from "../protocol/protocol";

/**
 * The request handler is responsible for dealing with the content of incoming and outgoing messages.
 * Each version of the API should extend the request handler.
 */
export class RequestHandler extends EventEmitter {
	private readonly messageHandlers = new Map<string, (data: any, message: Message) => Promise<unknown>>();
	/** A list containing all message types that should not be logged when received. */
	public readonly doNotLog = new Map<string, boolean>();

	/** For backwards compatibility we accept any amount of arguments, but they are no longer used. */
	public constructor(..._: any[]) {
		super();
	}

	public on(event: "message", listener: (type: string, data: unknown, message: Message) => void): this;
	public on(event: string | symbol, listener: (...args: any[]) => void): this;
	public on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	public emit(event: "message", type: string, data: unknown, message: Message): boolean;
	public emit(event: string | symbol, ...args: any[]): boolean;
	public emit(event: string | symbol, ...args: any[]): boolean {
		return super.emit(event, ...args);
	}

	/**
	 * Add a new message handler.
	 * @param type The type of message
	 * @param handler The handler to deal with the message.
	 */
	protected addMessageHandler(type: string, handler: (data: any, message: Message) => Promise<unknown>, log: boolean = true): void {
		const lowerType = type.toLowerCase();
		this.messageHandlers.set(lowerType, handler);
		if (!log) {
			this.doNotLog.set(lowerType, true);
		}
	}

	/**
	 * Called when there is a new message.
	 * @param type The type of message
	 * @param data The data with the message
	 */
	public receiveMessage(type: string, data: unknown, message: Message): Promise<unknown> {
		this.emit("message", type, data, message);
		const responseFunction = this.messageHandlers.get(type);
		if (responseFunction === undefined) {
			return Promise.reject(`Invalid type: ${type}, supported types: ${Array.from(this.messageHandlers.keys()).join(", ")}`);
		} else {
			//'this' is lost if we do not call it this way.
			return responseFunction.call(this, data, message);
		}
	}

	/** Turns a cookie string (from request.headers.cookie) in a map of key-value pairs. */
	protected cookieStringToMap(cookies: string | undefined): Map<string, string> {
		const cookieMap = new Map<string, string>();
		if (cookies !== undefined) {
			for (const cookie of cookies.split("; ")) {
				const cookieParts = cookie.split("=");
				cookieMap.set(cookieParts[0], cookieParts[1]);
			}
		}
		return cookieMap;
	}
}