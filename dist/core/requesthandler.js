"use strict";
/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestHandler = void 0;
const events_1 = require("events");
class RequestHandler extends events_1.EventEmitter {
    constructor(..._) {
        super();
        this.messageHandlers = new Map();
        this.doNotLog = new Map();
    }
    on(event, listener) {
        return super.on(event, listener);
    }
    emit(event, ...args) {
        return super.emit(event, ...args);
    }
    addMessageHandler(type, handler, log = true) {
        const lowerType = type.toLowerCase();
        this.messageHandlers.set(lowerType, handler);
        if (!log) {
            this.doNotLog.set(lowerType, true);
        }
    }
    receiveMessage(type, data, message) {
        this.emit("message", type, data, message);
        const responseFunction = this.messageHandlers.get(type);
        if (responseFunction === undefined) {
            return Promise.reject(`Invalid type: ${type}, supported types: ${Array.from(this.messageHandlers.keys()).join(", ")}`);
        }
        else {
            return responseFunction.call(this, data, message);
        }
    }
    cookieStringToMap(cookies) {
        const cookieMap = new Map();
        if (cookies !== undefined) {
            for (const cookie of cookies.split("; ")) {
                const cookieParts = cookie.split("=");
                cookieMap.set(cookieParts[0], cookieParts[1]);
            }
        }
        return cookieMap;
    }
}
exports.RequestHandler = RequestHandler;
