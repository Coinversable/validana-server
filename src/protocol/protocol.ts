/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import * as WebSocket from "ws";
import * as Path from "path";
import { Worker } from "cluster";
import { Log } from "@coinversable/validana-core";
import { Config } from "../config";
import { RequestHandler } from "../core/requesthandler";
import { IncomingMessage, ServerResponse } from "http";

export interface Message<T = ServerResponse | WebSocket> {
	/** The request that was send. */
	request: IncomingMessage;
	/** The object used for sending the response. */
	response: T;
	/** When was this message received? Set this to undefined to not record latency. */
	latencyStart?: number;
	/** What headers should be used for the response. By default uses "Content-Type": "application/json" */
	responseHeaders?: { [key: string]: string };
	/** The status code of the response. Defaults to 200 (or 500 in case of an error). */
	statusCode?: number;
	/** Log the response of this message? Defaults to true. */
	log: boolean;
	/** What protocol was used to send this message? */
	protocol: Protocol;
	/** What version of the api was this message send to? */
	version: string;
	/** A session object that is shared between all messages for the same websocket connection. */
	session: { [key: string]: any };
	/** Message id? Only for websocket connections where there can be multiple requests in one connection. */
	id?: string;
}

/**
 * The protocol class is responsible for handeling messages transferred using this protocol
 *  and transforming it to a general format independent of the protocol.
 */
export abstract class Protocol {
	private static depricatedVserverApiWarning: boolean = false;
	protected readonly worker: Worker;
	protected readonly port: number;
	protected readonly apiVersions: Map<string, RequestHandler>;

	constructor(worker: Worker, port: number, requestHandlers: Map<string, RequestHandler>) {
		this.worker = worker;
		this.port = port;

		if (Config.get().VSERVER_API !== undefined) {
			if (!Protocol.depricatedVserverApiWarning) {
				Protocol.depricatedVserverApiWarning = true;
				Log.warn("Loading server apis through config file is depricated. Add them as an argument to start().");
			}

			//Add all versions of the API that we support and their url.
			const apis: { [api: string]: string } = JSON.parse(Config.get().VSERVER_API!);
			for (const apiName of Object.keys(apis)) {
				if (!requestHandlers.has(apiName.toLowerCase())) {
					//Require the file, which should have a default exported class that extends RequestHandler.
					const apiFile = require(Path.resolve(apis[apiName]));
					//Map the api name to the constructor of the exported class
					requestHandlers.set(apiName.toLowerCase(), new apiFile.default());
				}
			}
		}
		this.apiVersions = requestHandlers;
	}

	/**
	 * Send a response to the user.
	 * @param message the message you want to send a response for.
	 * @param data Optional data to send along with the response
	 */
	protected abstract sendResponse(message: Message, data: unknown): void;

	/**
	 * Send a push message to the user.
	 * @param message the message you want to send a push for.
	 * @param pushType the type of push we are doing
	 * @param data the data you want to push
	 */
	public abstract sendPush(message: Message, pushType: string, data: unknown): void;

	/** Returns whether this handler can send push messages. */
	public abstract canPush(): boolean;

	/**
	 * Send an error to the user.
	 * @param message the message that had an error
	 * @param error a description of the error. (Be careful what you send to the client as it may result in security issues!)
	 */
	protected abstract sendError(message: Message, error: string): void;

	/**
	 * Shutdown the server. Will emit "closed" if the server was not yet closed, or if this close is permanent and earlier it was not.
	 * @param permanent Should the server permanently stay down or not.
	 * @param graceful Should the server do a graceful shutdown, thus closing connections normally.
	 */
	public abstract shutdown(permanent: boolean, graceful: boolean): Promise<void>;
}