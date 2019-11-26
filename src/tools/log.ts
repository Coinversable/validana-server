/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import * as Raven from "raven";
import * as os from "os";

// Different colors for the terminal to provide a better overview.
enum c { red = "\x1b[31m", green = "\x1b[32m", yellow = "\x1b[33m", blue = "\x1b[34m", mangata = "\x1b[35m", cyan = "\x1b[36m", white = "\x1b[37m", grey = "\x1b[90m" }

// tslint:disable:no-console
export class Log {
	public static readonly Debug = 0;
	public static readonly Info = 1;
	public static readonly Warning = 2;
	public static readonly Error = 3;
	public static readonly Fatal = 4;
	public static readonly None = 5;
	public static Level = Log.Warning;
	private static reportErrors: boolean = false;
	public static options: Raven.CaptureOptions = {
		tags: {
			serverVersion: "1.0.1",
			nodejsVersion: process.versions.node,
			arch: process.arch,
			platform: process.platform,
			platformVersion: os.release()
		},
		extra: {}
	};

	/** Set this logger to report errors. Will throw an error if there are problems with the url. */
	public static setReportErrors(dns: string): void {
		this.reportErrors = true;
		Raven.config(dns);
	}

	/**  Is this logger registerd to report errors. */
	public static isReportingErrors(): boolean {
		return this.reportErrors;
	}

	/**
	 * Detailed information about the program flow that is used for debugging problems.
	 * @param msg Description of the issue
	 * @param error An optional error that may have arisen
	 */
	public static debug(msg: string, error?: Error): void {
		if (Log.Level <= Log.Debug) {
			console.log(`${c.grey}${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}${c.white}`);
		}
		//We never capture debug information for reporting errors.
	}

	/**
	 * Significant things that occur in normal circumstances.
	 * @param msg Description of the issue
	 * @param error An optional error that may have arisen
	 */
	public static info(msg: string, error?: Error): void {
		if (Log.Level <= Log.Info) {
			console.log(`${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}`);
		}
		if (this.reportErrors) {
			if (error !== undefined) {
				Raven.captureBreadcrumb({ level: "info", message: msg, data: { stack: error.stack } });
			} else {
				Raven.captureBreadcrumb({ level: "info", message: msg });
			}
		}
	}

	/**
	 * Problems which may occur in abnormal circumstances (loss of connection, etc), but are dealt with by the program.
	 * @param msg Description of the issue
	 * @param error An optional error that may have arisen
	 */
	public static warn(msg: string, error?: Error): void {
		if (Log.Level <= Log.Warning) {
			console.log(`${c.yellow}${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}${c.white}`);
		}
		if (this.reportErrors) {
			if (error !== undefined) {
				Raven.captureBreadcrumb({ level: "warning", message: msg, data: { stack: error.stack } });
			} else {
				Raven.captureBreadcrumb({ level: "warning", message: msg });
			}
		}
	}

	/**
	 * Errors which require modifying the program, because they should never happen.
	 * @param msg Description of the issue, if no error is provided make sure it is a fixed text message.
	 * @param error An optional error that may have arisen
	 */
	public static async error(msg: string, error?: Error | undefined): Promise<void> {
		if (Log.Level <= Log.Error) {
			console.error(`${c.red}${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}${c.white}`);
		}
		if (this.reportErrors) {
			this.options.level = "error";
			if (error !== undefined) {
				this.options.extra!.message = msg;
				return this.captureError(error, this.options);
			} else {
				return this.captureMessage(msg, this.options);
			}
		}
	}

	/**
	 * The kind of errors for which no recovery is possible, possibly including restarting the program.
	 * @param msg Description of the issue, if no error is provided make sure it is a fixed text message.
	 * @param error An optional error that may have arisen
	 */
	public static async fatal(msg: string, error?: Error | undefined): Promise<void> {
		if (Log.Level <= Log.Fatal) {
			console.error(`${c.red}${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}${c.white}`);
		}
		if (this.reportErrors) {
			this.options.level = "fatal";
			if (error !== undefined) {
				this.options.extra!.message = msg;
				return this.captureError(error, this.options);
			} else {
				return this.captureMessage(msg, this.options);
			}
		}
	}

	private static captureError(error: Error, options: Raven.CaptureOptions): Promise<void> {
		return new Promise<void>((resolve) => {
			Raven.captureException(error, options, (err) => {
				if (err !== null && err !== undefined) {
					Log.warn("Could not report error, is the sentry url valid?");
				}
				resolve();
			});
		});
	}

	private static captureMessage(message: string, options: Raven.CaptureOptions): Promise<void> {
		return new Promise<void>((resolve) => {
			Raven.captureMessage(message, options, (err) => {
				if (err !== null && err !== undefined) {
					Log.warn("Could not report error, is the sentry url valid?");
				}
				resolve();
			});
		});
	}
}