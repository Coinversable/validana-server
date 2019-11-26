/*!
 * @license
 * Copyright Coinversable B.V. All Rights responseerved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import * as querystring from "querystring";
import * as http from "http";
import { Socket } from "net";
import { Worker } from "cluster";
import { Log } from "@coinversable/validana-core";
import { Protocol, Message } from "./protocol";
import { Config } from "../config";
import { RequestHandler } from "../core/requesthandler";
import { HttpServer } from "../core/httpserver";
import { Metrics } from "../core/metrics";

export class HttpProtocol extends Protocol {
	private static readonly headerOptionsFailed = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "POST, GET",
		"Access-Control-Allow-Headers": "origin, content-type, accept",
		"Access-Control-Max-Age": 86400
	};
	private static readonly headerOptionsSuccess = Object.assign({
		"Content-Type": "application/json"
	}, HttpProtocol.headerOptionsFailed);
	private readonly httpServer: HttpServer;
	private readonly maxPayloadSize: number;

	//Current open connections.
	private readonly connections: Socket[] = [];

	/**
	 * Creates a new Protocol.
	 * @param worker The worker that created this handler.
	 * @param portOrServer A server to use or a port for which a new server will be created.
	 */
	constructor(worker: Worker, portOrServer: number | HttpServer, requestHandlers: Map<string, RequestHandler>) {
		super(worker, portOrServer instanceof HttpServer ? portOrServer.port : portOrServer, requestHandlers);
		this.maxPayloadSize = Config.get().VSERVER_MAXPAYLOADSIZE;

		this.httpServer = portOrServer instanceof HttpServer ? portOrServer : new HttpServer(portOrServer);
		this.httpServer.on("close", (permanent, graceful) => {
			//If we are permanently shutting down, otherwise keep existing connections.
			if (permanent) {
				for (const connection of this.connections) {
					//If end was not yet called close the connection.
					if (!connection.writableEnded) {
						connection.end();
					}
					//If this is not a graceful shutdown destroy the socket after a short timeout.
					if (!graceful) {
						const timeout = setTimeout(() => connection.destroy(), 5000);
						connection.on("close", () => clearTimeout(timeout));
					}
				}
			}
		});

		this.httpServer.server.on("connection", (socket) => socket.setTimeout(120000, () => socket.destroy()));

		this.httpServer.server.on("request", async (request: http.IncomingMessage, response: http.ServerResponse) => {
			//Remove timeout now request has come in.
			request.socket.setTimeout(0);
			//Add to list of active connections (due to keepalive, a request may reuse the same socket)
			if (this.connections.indexOf(request.socket) === -1) {
				this.connections.push(request.socket);
				request.socket.on("close", () => this.connections.splice(this.connections.indexOf(request.socket), 1));
			}

			//Support pre-flight requests
			if (request.method === "OPTIONS") {
				Metrics.stats.requestsSuccessresponset++;
				response.writeHead(200, HttpProtocol.headerOptionsFailed);
				response.end();
				return;
			}

			if (request.url!.length > this.maxPayloadSize) {
				Metrics.stats.requestsClientErrorresponset++;
				response.writeHead(414, HttpProtocol.headerOptionsFailed);
				response.end();
				return;
			}
			let url;
			try {
				url = decodeURI(request.url!);
			} catch (error) {
				Metrics.stats.requestsClientErrorresponset++;
				response.writeHead(400, HttpProtocol.headerOptionsFailed);
				response.end("Invalid request url.");
				return;
			}

			const index = url.indexOf("?");
			const path = index === -1 ? url : url.slice(0, index);
			const urlParts = path.match(/[^\/]+/g);

			//See if it has an api version and request type
			if (urlParts === null || urlParts.length < 2) {
				Metrics.stats.requestsClientErrorresponset++;
				response.writeHead(400, HttpProtocol.headerOptionsFailed);
				response.end("Missing api version or request type.");
				return;
			}

			//Get the api version and requestType
			const versionIndex = urlParts.findIndex((part) => this.apiVersions.has(part));
			if (versionIndex === -1) {
				Metrics.stats.requestsClientErrorresponset++;
				response.writeHead(400, HttpProtocol.headerOptionsFailed);
				response.end("Api version missing or not supported.");
				return;
			}
			const version = urlParts[versionIndex];
			const type = urlParts.slice(versionIndex + 1).join("/").toLowerCase();

			let data: unknown;
			if (request.method === "GET") {
				let query = "";
				if (index !== -1) {
					query = url.slice(index + 1);
					try {
						//website.com/api/v1/responseource?{"data":"something","data2":"something2"} format
						data = JSON.parse(query);
					} catch (error) {
						if (query.indexOf("=") !== -1) {
							//website.com/api/v1/responseource?data=something&data2=something2&data3=something2 format (only string/string[] is supported)
							data = querystring.parse(query);
						} else {
							//website.com/api/v1/responseource?something format (only string is supported)
							data = query;
						}
					}
				}

				this.requestHandler({
					log: true, request, response, version, protocol: this, latencyStart: Date.now(), session: {}
				}, type, data, query);
			} else if (request.method === "POST") {
				//In case of a post request read the request body and try to parse it as json.
				let body = "";

				//Read part of the body
				request.on("data", (postData) => {
					body += postData.toString();
					if (this.maxPayloadSize !== 0 && body.length > this.maxPayloadSize) {
						Metrics.stats.requestsClientErrorresponset++;
						response.writeHead(413, HttpProtocol.headerOptionsFailed);
						response.end("Payload too large.");
						return;
					}
				});

				//Finished reading body
				request.on("end", () => {
					if (body.length > 0) {
						try {
							data = JSON.parse(body);
						} catch (error) {
							Metrics.stats.requestsClientErrorresponset++;
							response.writeHead(400, HttpProtocol.headerOptionsFailed);
							response.end("Invalid request json.");
							return;
						}
					}

					this.requestHandler({
						log: true, request, response, version, protocol: this, latencyStart: Date.now(), session: {}
					}, type, data, body);
				});
			} else {
				Metrics.stats.requestsClientErrorRest++;
				response.writeHead(405, HttpProtocol.headerOptionsFailed);
				response.end("Invalid request method.");
			}
		});
	}

	/** Handle a get or post request by creating a request handler and providing it with the request data. */
	private async requestHandler(message: Message<http.ServerResponse>, type: string, data: unknown, dataString: string): Promise<void> {
		//Create a request handler for this request version and add it the the list of connected request handlers.
		const RH = this.apiVersions.get(message.version)!;
		if (!RH.doNotLog.has(type)) {
			//Fastest way to remove sessionId. When using a different name use addMessageHandler with log=false
			const toLog = dataString.slice(0, 1000).replace(/sessionId("\s*:\s*"|=)(.{5})[^"&]+/, `sessionId$1$2***`);
			Log.debug(`Received message ${message.version}:${type}: ${toLog}`);
		}

		try {
			this.sendResponse(message, await RH.receiveMessage(type, data, message));
		} catch (error) {
			//Differentiate between internal errors and rejects caused by bad client requests/other info.
			if (error instanceof Error) {
				Log.warn("Request data that resulted in error: " + data);
				Log.error(`Error occured during request of type ${message.version}:${type}.`, error);
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
	}

	public shutdown(permanent: boolean, graceful: boolean): Promise<void> {
		return this.httpServer.shutdown(permanent, graceful);
	}

	protected sendResponse(message: Message<http.ServerResponse>, data: unknown): void {
		if (!message.request.socket.writableEnded && !message.request.socket.destroyed) {
			//Get status code
			const statusCode = message.statusCode ?? 200;
			if (statusCode < 400) {
				Metrics.stats.requestsSuccessresponset++;
			} else if (statusCode < 500) {
				Metrics.stats.requestsClientErrorresponset++;
			} else {
				Metrics.stats.requestsServerErrorresponset++;
			}

			//Add headers and send response
			let dataString: any;
			if (message.responseHeaders !== undefined) {
				//We create a new copy to not modify headerOptionsSuccess, but headers should be able to overwrite the default options.
				message.response.writeHead(statusCode, Object.assign({}, HttpProtocol.headerOptionsSuccess, message.responseHeaders));
				if (message.responseHeaders["Content-Type"] !== undefined) {
					dataString = data;
				} else {
					dataString = JSON.stringify(data);
				}
			} else {
				dataString = JSON.stringify(data);
				message.response.writeHead(statusCode, HttpProtocol.headerOptionsSuccess);
			}
			if (message.log) {
				Log.debug(`Send response: ${dataString === undefined ? undefined : dataString.slice(0, 2000)}`);
			}
			message.response.end(dataString);
		}
	}

	public sendPush(_: Message, pushType: string, data: {}): void {
		//Do nothing, we don't support pushes.
		const dataString = JSON.stringify(data);
		Log.warn(`Push type: ${pushType}, pushData: ${dataString === undefined ? dataString : dataString.slice(0, 2000)}`);
		Log.error("Tried to send push for a http handler.");
	}

	public canPush(): false {
		return false;
	}

	protected sendError(message: Message<http.ServerResponse>, error: string): void {
		if (!message.request.socket.writableEnded && !message.request.socket.destroyed) {
			if (message.log) {
				Log.debug(`Send error: ${error}`);
			}

			//Get status code
			const statusCode = message.statusCode ?? 500;
			if (statusCode >= 400 && statusCode < 500) {
				Metrics.stats.requestsClientErrorresponset++;
			} else { //sendError should only be used for errors
				Metrics.stats.requestsServerErrorresponset++;
			}

			//Add headers
			if (message.responseHeaders !== undefined) {
				//We create a new copy to not modify headerOptionsFailed, but headers should be able to overwrite the default options.
				message.response.writeHead(statusCode, Object.assign({}, HttpProtocol.headerOptionsFailed, message.responseHeaders));
			} else {
				message.response.writeHead(statusCode, HttpProtocol.headerOptionsFailed);
			}
			message.response.end(error);
		}
	}
}