/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import * as Cluster from "cluster";
import * as OS from "os";
import { Log } from "@coinversable/validana-core";
import { Protocol } from "./protocol/protocol";
import { HttpProtocol } from "./protocol/http";
import { WebsocketProtocol } from "./protocol/websocket";
import { Database, DBTransaction } from "./core/database";
import { Config } from "./config";
import { HttpServer } from "./core/httpserver";
import { RequestHandler } from "./core/requesthandler";
import { ServerEventGenerator, ServerEventEmitter } from "./core/events";
import { Metrics } from "./core/metrics";

/** An extension to the standard cluster worker to see how many times it failed to notify the master. */
class ExtendedWorker extends Cluster.Worker {
	public notNotifiedTimes: number | undefined;
}

/**
 * The app is responsible for setting up the cluster of workers and restarting them if needed.
 * Calling start will start this process.
 */
export function start(requestHandlers = new Map<string, RequestHandler>()): void {

	//What if there is an exception that was not cought
	process.on("uncaughtException", async (error: Error) => {
		if (error.stack === undefined) {
			error.stack = "";
		}
		//Do not accidentially capture password
		if (Config.get().VSERVER_DBPASSWORD !== undefined) {
			error.message = error.message.replace(new RegExp(Config.get().VSERVER_DBPASSWORD!, "g"), "");
			error.stack = error.stack.replace(new RegExp(Config.get().VSERVER_DBPASSWORD!, "g"), "");
		}
		await Log.fatal("uncaughtException", error);
		process.exit(2);
	});
	process.on("unhandledRejection", async (reason: unknown, promise: Promise<unknown>) => {
		let error: Error | undefined;
		await promise.catch((e) => error = e);
		await Log.fatal(`unhandledRejection: ${reason}`, error);
		process.exit(2);
	});
	process.on("warning", (warning: Error) => {
		Log.warn("Process warning", warning);
	});

	const version: number[] = [];
	for (const subVersion of process.versions.node.split(".")) {
		version.push(Number.parseInt(subVersion, 10));
	}
	//Bug in setInterval makes it stop working after 2^31 ms = 25 days
	if (version[0] === 10 && version[1] <= 8) {
		throw new Error(`Please upgrade to node js version 10.9, there is a problematic bug in earlier 10.x versions, ` +
			`current version: ${process.versions.node}.`);
	}

	//Load the config
	try {
		Config.get();
		if (Config.get().VSERVER_SENTRYURL !== undefined) {
			Log.setReportErrors(Config.get().VSERVER_SENTRYURL!);
		}
	} catch (error) {
		Log.error(`${error.message} Exiting process.`);
		process.exit(1);
	}

	//Set log information:
	Log.options.tags.master = Cluster.isMaster.toString();
	Log.options.tags.nodejsVersion = process.versions.node;
	Log.options.tags.serverVersion = require("../package.json").version;
	Log.Level = Config.get().VSERVER_LOGLEVEL;
	if (Config.get().VSERVER_LOGFORMAT !== undefined) {
		Log.LogFormat = Config.get().VSERVER_LOGFORMAT!;
	}

	let isShuttingDown: boolean = false;
	let isGraceful: boolean = true;

	//Check if this is the master or a worker.
	if (Cluster.isMaster) {
		setupMaster();
	} else {
		setupWorker();
	}

	/** Setup the master. */
	function setupMaster(): void {
		Log.info(`Master (pid: ${process.pid}) is running`);

		//Start the workers.
		let workers = Config.get().VSERVER_WORKERS;
		if (workers <= 0) {
			workers = Math.max(1, OS.cpus().length + workers);
		}
		for (let i = 0; i < workers; i++) {
			createWorker();
		}

		//If a worker shuts down.
		Cluster.on("exit", (worker: Cluster.Worker, code: number, _: string) => {
			if (code === 0) {
				//Should only happen if master told worker to shut down, for example when we tell the master to shut down.
				Log.info(`Worker ${worker.id} (pid: ${worker.process.pid}) exited.`);
			} else {
				Log.info(`Worker ${worker.id} (pid: ${worker.process.pid}) died with code ${code}`);
				Log.error(`Worker died with code ${code}`);
			}

			//handler notified that it wants to stay down for a while.
			if (code >= 50 && code < 60) {
				setTimeout(createWorker, 30000);
			} else {
				setTimeout(createWorker, 1000);
			}
		});

		//If a worker send a message.
		Cluster.on("message", (worker: Cluster.Worker, message: any) => {
			if (typeof message === "object" && message !== null && message.type === "report" && Number.isFinite(message.memory)) {
				//If the message is the amount of memory the worker uses (which is also a ping it is still active)
				(worker as ExtendedWorker).notNotifiedTimes = 0;
				if (message.memory > Config.get().VSERVER_MAXMEMORY && Config.get().VSERVER_MAXMEMORY !== 0) {
					Log.warn(`Worker ${worker.id} using too much memory, restarting worker.`);
					shutdownWorker(worker.id.toString(), true);
				}
			} else {
				//If it was not a known message type.
				Log.info(`Worker ${worker.id} send an unknown message.`);
				Log.error("Worker send an unknown message.");
			}
		});

		//Check if the worker is still responding
		setInterval(() => {
			for (const id of Object.keys(Cluster.workers)) {
				const worker = Cluster.workers[id] as ExtendedWorker | undefined;
				if (worker !== undefined) {
					if (worker.notNotifiedTimes === undefined) {
						worker.notNotifiedTimes = 0;
					} else if (worker.notNotifiedTimes === 3) {
						Log.info(`Worker ${id} failed to notify for ${3 * worker.notNotifiedTimes} seconds, restarting worker.`);
						Log.error("Worker failed to notify multiple times, restarting worker.");
						shutdownWorker(id, true);
					} else if (worker.notNotifiedTimes > 0) {
						Log.warn(`Worker ${id} failed to notify.`);
					}
					worker.notNotifiedTimes++;
				}
			}
		}, 10000);

		//What to do if we receive a signal to shutdown
		process.on("SIGINT", () => {
			Log.info(`Master (pid: ${process.pid}) received SIGINT`);
			shutdownMaster(false);
		});
		process.on("SIGTERM", () => {
			Log.info(`Master (pid: ${process.pid}) received SIGTERM`);
			shutdownMaster(true);
		});
	}

	/** Shutdown the master. */
	function shutdownMaster(hardkill: boolean, code: number = 0): void {
		if (!isShuttingDown) {
			Log.info(`Master (pid: ${process.pid}) shutting down...`);

			isShuttingDown = true;

			//Send shutdown signal to all workers.
			isGraceful = true;
			for (const id of Object.keys(Cluster.workers)) {
				shutdownWorker(id, hardkill);
			}

			setInterval(() => {
				if (Object.keys(Cluster.workers).length === 0) {
					Log.info("Shutdown completed");
					process.exit(code === 0 && !isGraceful ? 1 : code);
				}
			}, 500);
		}
	}

	/** Setup a worker. */
	function setupWorker(): void {
		//If this process encounters an error when being created/destroyed. We do not do a graceful shutdown in this case.
		Cluster.worker.on("error", (error) => {
			Log.error("Worker encountered an error", error);
			process.exit(1);
		});

		Log.info(`Worker ${Cluster.worker.id} (pid: ${process.pid}) started`);

		//Setup heartbeat
		setInterval(() => {
			const memory = process.memoryUsage();
			Cluster.worker.send({ type: "report", memory: (memory.heapTotal + memory.external) / 1024 / 1024 });
		}, 5000);

		//Setup the database
		Database.get().setup({
			database: Config.get().VSERVER_DBNAME,
			user: Config.get().VSERVER_DBUSER,
			password: Config.get().VSERVER_DBPASSWORD,
			host: Config.get().VSERVER_DBHOST,
			port: Config.get().VSERVER_DBPORT,
			min: Config.get().VSERVER_DBMINCONNECTIONS,
			max: Config.get().VSERVER_DBMAXCONNECTIONS,
			connectionTimeoutMillis: 5000
		});

		//Listen to new blocks being processed
		listenNewBlocks();

		//Update metrics.
		if (Config.get().VSERVER_METRICSINTERVAL !== 0) {
			const metricsEventGenerator = new ServerEventGenerator(Metrics.sync, Config.get().VSERVER_METRICSINTERVAL * 1000);
			Database.get().on("destroy", () => metricsEventGenerator.stop());
		}

		//Protocols to handle incoming connections.
		const protocols: Protocol[] = [];
		let server: HttpServer | undefined;
		if (Config.get().VSERVER_HTTPPORT === Config.get().VSERVER_WSPORT) {
			server = new HttpServer(Config.get().VSERVER_HTTPPORT);
		}
		if (Config.get().VSERVER_HTTPPORT !== 0) {
			protocols.push(new HttpProtocol(Cluster.worker, server ?? Config.get().VSERVER_HTTPPORT, requestHandlers));
		}
		if (Config.get().VSERVER_WSPORT !== 0) {
			protocols.push(new WebsocketProtocol(Cluster.worker, server ?? Config.get().VSERVER_WSPORT, requestHandlers));
		}

		//If the master sends a shutdown message we do a graceful shutdown.
		Cluster.worker.on("message", async (message: any) => {
			Log.info(`Worker ${Cluster.worker.id} (pid: ${process.pid}) received message: ${message?.type}`);
			if (message.type === "shutdown" && typeof message.graceful === "boolean") {
				if (!isShuttingDown) {
					isShuttingDown = true;
					const promises = [];
					for (const protocol of protocols) {
						promises.push(protocol.shutdown(true, message.graceful));
					}
					promises.push(Database.shutdownAll());
					await Promise.all<any>(promises);
					process.exit(0);
				}
			}
		});

		//What to do if we receive a signal to shutdown?
		process.on("SIGTERM", async () => {
			Log.info(`Worker ${Cluster.worker.id} (pid: ${process.pid}) received SIGTERM`);
			if (!isShuttingDown) {
				isShuttingDown = true;
				const promises = [];
				for (const protocol of protocols) {
					promises.push(protocol.shutdown(true, false));
				}
				promises.push(Database.shutdownAll());
				await Promise.all<any>(promises);
				process.exit(0);
			}
		});
		process.on("SIGINT", async () => {
			Log.info(`Worker ${Cluster.worker.id} (pid: ${process.pid}) received SIGINT`);
			if (!isShuttingDown) {
				isShuttingDown = true;
				const promises = [];
				for (const protocol of protocols) {
					promises.push(protocol.shutdown(true, true));
				}
				promises.push(Database.shutdownAll());
				await Promise.all<any>(promises);
				process.exit(0);
			}
		});
	}

	/** Let a worker listen for new blocks being processed. */
	async function listenNewBlocks(): Promise<void> {
		//Use dedicated connection to avoid using up pool slots.
		const connection = Database.get().getDedicatedConnection();
		//If something goes wrong reconnect in a moment.
		connection.on("end", () => setTimeout(() => listenNewBlocks(), 5000));
		//When a new block is processed:
		connection.on("notification", async (message) => {
			const payload: { block?: number, ts: number, txs?: number, other: number } = JSON.parse(message.payload!);
			//Check if there were any transactions inside the block and someone is listening for new transactions.
			if ((payload.txs !== undefined && payload.txs > 0 || payload.other !== 0) && (
				ServerEventEmitter.get("transactionId").hasSubscribers() ||
				ServerEventEmitter.get("transaction").hasSubscribers() ||
				ServerEventEmitter.get("transactionContract").hasSubscribers() ||
				ServerEventEmitter.get("transactionAddress").hasSubscribers())) {

				const result = await Database.get().query("SELECT * FROM basics.transactions WHERE processed_ts = $1;", [payload.ts]);
				//Notify listeners about the new transactions.
				for (const row of result.rows as DBTransaction[]) {
					ServerEventEmitter.get("transactionId").emit(row, row.transaction_id.toString("hex"));
					if (row.sender !== null) {
						ServerEventEmitter.get("transactionAddress").emit(row, row.sender);
					}
					if (row.receiver !== null) {
						ServerEventEmitter.get("transactionAddress").emit(row, row.receiver);
					}
					if (row.contract_type !== null) {
						ServerEventEmitter.get("transactionContract").emit(row, row.contract_type);
					}
					ServerEventEmitter.get("transaction").emit(row);
				}
			}
		});
		try {
			await connection.connect();
		} catch (error) {
			//Database will take care of logging.
			//on("end") is called which will setup a new connection in a moment.
		}
		try {
			await connection.query("LISTEN blocks;");
		} catch (error) {
			//Call on("end") which will setup a new connection in a moment.
			await connection.end().catch(() => {});
		}
	}

	/** Create a new worker. Will retry until it succeeds. */
	function createWorker(timeout: number = 5000): void {
		if (!isShuttingDown) {
			try {
				Cluster.fork(Config.get());
			} catch (error) {
				Log.warn("Failed to start worker", error);
				//Increase retry time up to 5 min max.
				setTimeout(createWorker, timeout, Math.min(timeout * 1.5, 300000));
			}
		}
	}

	/**
	 * Shutdown a worker.
	 * @param id the id of the worker to shut down.
	 * @param hardkill whether to kill the worker if it does not gracefully shutdown within 10 seconds.
	 */
	function shutdownWorker(id: string, hardkill: boolean): void {
		//Send shutdown message for a chance to do a graceful shutdown.
		if (Cluster.workers[id] !== undefined) {
			Cluster.workers[id]!.send({ type: "shutdown", graceful: !hardkill }, undefined, (error: Error | null) => {
				//Doesn't matter if it fails, there will be a hard kill in 10 seconds.
				//(write EPIPE errors mean the worker closed the connection, properly because it already exited.)
				if (error !== null && error.message !== "write EPIPE") {
					Log.warn(`Worker ${id} shutdown failed`, error);
				}
			});
		} else {
			Log.info(`Trying to shutdown non-existing worker ${id}`);
			Log.error("Trying to shutdown non-existing worker");
		}

		//Give every handler 10 seconds to shut down before doing a hard kill.
		if (hardkill) {
			setTimeout(() => {
				if (Cluster.workers[id] !== undefined) {
					isGraceful = false;
					Log.info(`Worker ${id} not shutting down.`);
					Log.fatal("Hard killing worker.");
					process.kill(Cluster.workers[id]!.process.pid, "SIGKILL");
				}
			}, 10000);
		}
	}
}