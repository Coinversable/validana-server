import * as http from "http";
import * as https from "https";
import * as FS from "fs";
import { Log } from "@coinversable/validana-core";
import { Config } from "../config";
import { EventEmitter } from "events";

/**
 * Barebone http(s) server that listens on a port and will restart itsself in case of errors.
 * Will not do anything with incoming messages.
 */
export class HttpServer extends EventEmitter {
	public readonly server: http.Server | https.Server;
	public readonly port: number;
	private permanentlyClosed: boolean = false;
	private restartTimeout: number = 5000;

	constructor(port: number) {
		super();
		this.port = port;
		//Setup the rest server
		if (!Config.get().VSERVER_TLS) {
			this.server = http.createServer();
		} else {
			this.server = https.createServer(this.loadCertificate()!);
			//If the file changes give it a second for both the key and the cert to change, then reload.
			FS.watchFile(Config.get().VSERVER_CERTPATH!, (curr, prev) => {
				//Check if the file was modified and not just opened.
				if (curr.mtime !== prev.mtime) {
					setTimeout(() => {
						Log.info("Reloading certificate.");
						const newCertificate = this.loadCertificate();
						//Only reload if it succeeded loading the files.
						if (newCertificate !== undefined) {
							try {
								if ((this.server as any).setSecureContext instanceof Function) {
									//Available since node 11
									(this.server as any).setSecureContext(newCertificate);
								} else {
									//Not officially available, but it works anyway.
									(this.server as any)._sharedCreds.context.setCert(newCertificate.cert);
									(this.server as any)._sharedCreds.context.setKey(newCertificate.key);
								}
							} catch (error) {
								//Do not log possible certificate
								Log.error("Problem with reloading certificate.");
							}
						}
					}, 5000);
				}
			});
		}

		this.server.on("listening", () => this.restartTimeout = 5000);

		//Restart the server in a bit after an error.
		this.server.on("error", async (error) => {
			Log.warn("Server error", error);
			if (!this.server.listening) {
				this.restartTimeout = Math.min(this.restartTimeout * 1.5, 300000);
				await this.shutdown(false, true);
				setTimeout(() => {
					if (!this.permanentlyClosed) {
						this.server.listen(this.port);
					}
				}, this.restartTimeout);
			} else {
				await this.shutdown(false, true);
				setTimeout(() => {
					if (!this.permanentlyClosed) {
						this.server.listen(this.port);
					}
				}, this.restartTimeout);
			}
		});

		this.server.listen(this.port);
	}

	/**
	 * Shutdown the server.
	 * @param permanent Should the server permanently stay down or not.
	 * @param graceful Should the server do a graceful shutdown, thus closing connections normally.
	 */
	public async shutdown(permanent: boolean, graceful: boolean): Promise<void> {
		this.permanentlyClosed = this.permanentlyClosed || permanent;

		//Stop accepting new connections.
		this.server.close();

		//Notify listeners that we closed the server to new connections (but not yet closed all connections).
		this.emit("close", permanent, graceful);
	}

	/**
	 * Load the certificate from the location found in the config file (if any).
	 * Returns undefined if it failed to load the certificate.
	 */
	private loadCertificate(): { key: Buffer, cert: Buffer } | undefined {
		try {
			return {
				key: FS.readFileSync(Config.get().VSERVER_KEYPATH!),
				cert: FS.readFileSync(Config.get().VSERVER_CERTPATH!)
			};
		} catch (error) {
			//Do not log error as it may contain the certificate key.
			Log.error(`Failed to load certificate at: key: ${Config.get().VSERVER_KEYPATH} and cert: ${Config.get().VSERVER_CERTPATH}.`);
			return undefined;
		}
	}

	public on(event: "close", listener: (permanent: boolean, graceful: boolean) => void): this;
	public on(event: string, listener: (...args: any[]) => void): this;
	public on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}
}