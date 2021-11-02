/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import * as WebSocket from "ws";
import { Worker } from "cluster";
import { Log } from "@coinversable/validana-core";
import { RequestHandler } from "../core/requesthandler";
import { Config } from "../config";
import { Protocol, Message } from "./protocol";
import { HttpServer } from "../core/httpserver";
import { Metrics } from "../core/metrics";

/** Simple extension to see if the WebSocket is still connected. */
class ExtendedWebSocket extends WebSocket {
	public isAlive: boolean = false;
	public startTime: number | undefined;
}

/** Expected request message format. */
interface RequestMessage {
	type: string;
	id: string;
	data?: any;
}

/** Interface for responding. */
interface ResponseOrPushMessage {
	status: number;
	error?: string;
	data?: unknown;
	id?: string;
	pushType?: string;
}

/**
 * The protocol is responsible for receiving websocket connections
 * as well as receiving messages and sending messages.
 */
export class WebsocketProtocol extends Protocol {
	private wsServer: WebSocket.Server;
	private serverOptions: WebSocket.ServerOptions | undefined;
	private timeout: number | undefined;
	private readonly httpServer: HttpServer;

	/** Active connections. */
	private readonly connections: WebSocket[] = [];

	/**
	 * Creates a new Protocol.
	 * @param worker The worker that created this protocol.
	 * @param portOrServer A server to use or a port for which a new server will be created.
	 */
	constructor(worker: Worker, portOrServer: number | HttpServer, requestHandlers: Map<string, RequestHandler>) {
		super(worker, portOrServer instanceof HttpServer ? portOrServer.port : portOrServer, requestHandlers);

		this.httpServer = portOrServer instanceof HttpServer ? portOrServer : new HttpServer(portOrServer);
		this.httpServer.on("close", (permanent, graceful) => {
			if (permanent) {
				for (const connection of this.connections) {
					//Protocol defines 1001 as server going down.
					if (connection.readyState !== WebSocket.CLOSING && connection.readyState !== WebSocket.CLOSED) {
						connection.close(1001, "Server shutting down/restarting.");
					}
					//If this is not a graceful shutdown destroy the socket after a short timeout.
					if (!graceful) {
						const timeout = setTimeout(() => connection.terminate(), 5000);
						connection.on("close", () => clearTimeout(timeout));
					}
				}
			}
		});

		this.timeout = Config.get().VSERVER_TIMEOUT;
		this.serverOptions = {
			maxPayload: Config.get().VSERVER_MAXPAYLOADSIZE === 0 ? undefined : Config.get().VSERVER_MAXPAYLOADSIZE,
			server: this.httpServer.server
		};

		this.wsServer = new WebSocket.Server(this.serverOptions);

		//Every second check for 1/timeout number of clients if they are still alive, for an average of once per timeout for each client.
		let currentTimer = this.timeout;
		let clientsToCheck: ExtendedWebSocket[] = [];
		const interval = setInterval(() => {
			if (this.httpServer.server.listening) {
				currentTimer--;
				//We have finished for all client, get all clients again
				if (currentTimer === 0) {
					clientsToCheck = Array.from(this.wsServer.clients) as ExtendedWebSocket[];
					currentTimer = this.timeout!;
				}
				//For all clients that we still need to check check 1/timeout part of them
				const clientsToCheckThisTime = Math.ceil(1 / currentTimer * clientsToCheck.length);
				for (let i = 0; i < clientsToCheckThisTime; i++) {
					//Remove them from the list of clients to check.
					const client = clientsToCheck.pop()!;
					//If it is still open (e.g. not already terminated since indexing and arriving here):
					if (client.readyState === WebSocket.OPEN) {
						if (!client.isAlive) {
							//If the client is no longer responding to 'keep alive' message.
							client.close(1001, "No longer responding to keep alive.");
							continue;
						}
						client.isAlive = false;
						client.ping();
					}
				}
			} else {
				//Server is down, clear interval, it will be started again when server starts again.
				clearInterval(interval);
			}
		}, 1000);

		//What if someone connects?
		this.wsServer.on("connection", (client: ExtendedWebSocket, request) => {
			//Remove timeout now request has come in.
			request.socket.setTimeout(0);
			//Add to list of active connections
			this.connections.push(client);
			client.on("close", () => {
				if (client.startTime !== undefined) {
					Metrics.recordDuration(client.startTime);
				}
				this.connections.splice(this.connections.indexOf(client), 1);
			});

			const session = {};
			Log.debug(`Worker ${this.worker.id} received an incoming connection.`);

			//Check if the client connects in a valid way.
			if (request.url === undefined) {
				Metrics.stats.requestsClientErrorWs++;
				client.close(4100, "Invalid way of connecting.");
				return;
			}
			let urlParts;
			try {
				urlParts = decodeURI(request.url).toLowerCase().match(/[^\/]+/g);
			} catch (error) {
				Metrics.stats.requestsClientErrorWs++;
				client.close(4100, "Invalid url.");
				return;
			}

			//Check if the client tries to connect to a valid api version.
			if (urlParts === null || urlParts.length === 0) {
				Metrics.stats.requestsClientErrorWs++;
				client.close(4100, "Missing api version or request type.");
				return;
			}

			//Get the api version and requestType
			const version = urlParts.find((part) => this.apiVersions.has(part));
			if (version === undefined) {
				Metrics.stats.requestsClientErrorWs++;
				client.close(4100, "Version of the api is not supported.");
				return;
			}

			const RH = this.apiVersions.get(version)!;
			client.isAlive = true;
			client.startTime = Date.now();
			Metrics.stats.wsConnections++;

			//There is an error with the client connection.
			client.on("error", (error) => {
				if (client.readyState === WebSocket.OPEN) {
					client.close(1006, "Websocket error");
				}
				//Some browsers cause an 'read ECONNRESET' to be thrown when refreshing: https://bugs.chromium.org/p/chromium/issues/detail?id=798194#c6
				if (error.message !== "read ECONNRESET") {
					Log.warn("Websocket error", error);
				}
			});

			//If we receive a reply to our 'keep alive' message mark client as still alive.
			client.on("pong", () => {
				client.isAlive = true;
			});

			//The client send a message.
			client.on("message", async (requestData: WebSocket.Data) => {
				const message: Message<WebSocket> = {
					log: true, protocol: this, request, version, latencyStart: Date.now(), response: client, session
				};

				//If the request is not valid json.
				const requestString = requestData instanceof Array ?
					requestData.map((part) => part.toString()).join("") : requestData.toString();
				let requestMessage: RequestMessage;
				try {
					requestMessage = JSON.parse(requestString);
				} catch (error) {
					message.statusCode = 400;
					return this.sendError(message, "Invalid JSON");
				}

				//If the message is missing important fields
				if (typeof requestMessage.id !== "string") {
					message.statusCode = 400;
					return this.sendError(message, "Request is missing or has an invalid an ID field");
				}
				message.id = requestMessage.id;
				if (typeof requestMessage.type !== "string") {
					message.statusCode = 400;
					return this.sendError(message, "Request is missing or has an invalid request type");
				}

				const type = requestMessage.type.toLowerCase();
				if (!RH.doNotLog.has(type)) {
					//Fastest way to remove sessionId. When using a different name use addMessageHandler with log=false
					const toLog = requestString.slice(0, 1000).replace(/sessionId"\s*:\s*"(.{5})[^"]+/, `sessionId":"$1***`);
					Log.debug(`Received message ${version}:${type}: ${toLog}`);
				}

				try {
					this.sendResponse(message, await RH.receiveMessage(type, requestMessage.data, message));
				} catch (error) {
					//Differentiate between internal errors and rejects caused by bad client requests.
					if (error instanceof Error) {
						Log.warn("Request data that resulted in error: " + requestString);
						Log.error(`Error occured during request of type ${version}: ${type}.`, error);
						//Do not send actual error message for safety.
						this.sendError(message, "Error occured during request.");
					} else {
						//Set the status code as a client error if not yet set.
						if (message.statusCode === undefined) {
							message.statusCode = 400;
						}
						this.sendError(message, String(error));
					}
				}
				if (message.latencyStart !== undefined) {
					Metrics.recordLatency(message.latencyStart);
				}
			});
		});
	}

	public shutdown(permanent: boolean, graceful: boolean): Promise<void> {
		return this.httpServer.shutdown(permanent, graceful);
	}

	protected sendResponse(message: Message<WebSocket>, data: unknown): void {
		if (message.response.readyState === WebSocket.OPEN) {

			//Status code to response with
			const statusCode = message.statusCode ?? 200;
			if (statusCode < 400) {
				Metrics.stats.requestsSuccessWs++;
			} else if (statusCode < 500) {
				Metrics.stats.requestsClientErrorWs++;
			} else {
				Metrics.stats.requestsServerErrorWs++;
			}

			//Create the response object
			const responseString = JSON.stringify({
				id: message.id,
				status: statusCode,
				data
			} as ResponseOrPushMessage);

			//Log and send the response
			if (message.log) {
				Log.debug(`Send response: ${responseString.slice(0, 2000)}`);
			}
			message.response.send(responseString);
		} else {
			Log.warn(`Cannot send message, client state: ${message.response.readyState}`);
		}
	}

	public sendPush(message: Message<WebSocket>, pushType: string, data: any): void {
		if (message.response.readyState === WebSocket.OPEN) {
			const pushString = JSON.stringify({
				pushType,
				data,
				status: message.statusCode ?? 200
			} as ResponseOrPushMessage);
			if (message.log) {
				Log.debug(`Send push: ${pushString?.slice(0, 2000)} `);
			}
			message.response.send(pushString);
		} else {
			Log.warn(`Cannot send message, client state: ${message.response.readyState}`);
		}
	}

	public canPush(): true {
		return true;
	}

	protected sendError(message: Message<WebSocket>, error: string): void {
		if (message.response.readyState === WebSocket.OPEN) {
			const statusCode = message.statusCode ?? 500;
			if (statusCode >= 400 && statusCode < 500) {
				Metrics.stats.requestsClientErrorWs++;
			} else { //sendError should only be used for errors
				Metrics.stats.requestsServerErrorWs++;
			}
			const errorResponse: ResponseOrPushMessage = {
				error,
				status: statusCode,
				id: message.id
			};
			if (message.log) {
				Log.debug(`Send error(${message.id}): ${error} `);
			}
			message.response.send(JSON.stringify(errorResponse));
		} else {
			Log.warn(`Cannot send message, client state: ${message.response.readyState}`);
		}
	}
}