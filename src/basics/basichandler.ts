/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import { RequestHandler } from "../core/requesthandler";
import { addBasics } from "./addbasics";
//import { Message } from "../protocol/protocol";

/**
 * An example request handler that implements all basic functions for interacting with the blockchain.
 * It can easily be extended further with custom request types.
 */
export default class BasicHandler extends addBasics(RequestHandler) {
	/*constructor() {
		super();
		this.addMessageHandler("hello", this.helloMessage);
	}

	protected async helloMessage(data: string, message: Message): Promise<string> {
		if (typeof data !== "string") {
			//By throwing/rejecting with a string instead of error object the status code is set to 400 instead of 500.
			//We could also set message.statusCode to overwrite the default.
			return Promise.reject("Invalid name.");
		}
		//Websockets keep a session till the websocket is closed. Http keeps a session till the response is send.
		const oldName = message.session.name;
		message.session.name = data;
		if (oldName !== undefined && oldName !== data) {
			return "Goodbye " + oldName + ", and hello: " + data;
		} else {
			return "Hello " + data;
		}
	}*/
}