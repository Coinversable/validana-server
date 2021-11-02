"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerEventGenerator = exports.ServerEventEmitter = void 0;
const validana_core_1 = require("@coinversable/validana-core");
const WebSocket = require("ws");
class ServerEventEmitter {
    constructor() {
        this.subtypeToConnection = new Map();
    }
    static get(eventType) {
        let instance = this.instances.get(eventType);
        if (instance === undefined) {
            instance = new ServerEventEmitter();
            this.instances.set(eventType, instance);
        }
        return instance;
    }
    unsubscribe(message, subtype) {
        const connection = message === undefined ? undefined : message.response instanceof WebSocket ? message.response : message.response.connection;
        const connections = this.subtypeToConnection.get(subtype);
        if (connections !== undefined) {
            const newConnections = connections.filter((conn) => conn[0] !== connection);
            if (newConnections.length === 0) {
                this.subtypeToConnection.delete(subtype);
            }
            else {
                this.subtypeToConnection.set(subtype, newConnections);
            }
        }
    }
    subscribe(message, subscriber, subtype) {
        const connection = message === undefined ? undefined : message.response instanceof WebSocket ? message.response : message.response.socket;
        const connections = this.subtypeToConnection.get(subtype);
        if (connections === undefined) {
            this.subtypeToConnection.set(subtype, [[connection, subscriber]]);
        }
        else {
            connections.push([connection, subscriber]);
        }
        connection === null || connection === void 0 ? void 0 : connection.on("close", () => this.unsubscribe(message, subtype));
    }
    emit(data, subtype) {
        const connections = this.subtypeToConnection.get(subtype);
        if (connections !== undefined) {
            for (const connection of connections) {
                connection[1].call(connection[0], data);
            }
        }
    }
    isSubscribed(messageOrSubscriber, subtype) {
        const connections = this.subtypeToConnection.get(subtype);
        if (typeof messageOrSubscriber === "function") {
            return connections !== undefined && connections.some((connection) => connection[1] === messageOrSubscriber);
        }
        else {
            const thisConnection = messageOrSubscriber.response instanceof WebSocket ? messageOrSubscriber.response : messageOrSubscriber.response.connection;
            return connections !== undefined && connections.some((connection) => connection[0] === thisConnection);
        }
    }
    hasSubscribers(subtype) {
        if (subtype === undefined) {
            return this.subtypeToConnection.size > 0;
        }
        else {
            return this.subtypeToConnection.get(subtype) !== undefined;
        }
    }
    getSubscribersSize(subtype) {
        var _a, _b;
        if (subtype === undefined) {
            let total = 0;
            for (const subscribers of this.subtypeToConnection.values()) {
                total += subscribers.length;
            }
            return total;
        }
        else {
            return (_b = (_a = this.subtypeToConnection.get(subtype)) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
        }
    }
    getSubtypesSize() {
        return this.subtypeToConnection.size;
    }
    getSubtypes() {
        return this.subtypeToConnection.keys();
    }
}
exports.ServerEventEmitter = ServerEventEmitter;
ServerEventEmitter.instances = new Map();
class ServerEventGenerator {
    constructor(action, frequency) {
        this.failures = 0;
        this.running = 0;
        this.frequency = frequency;
        setTimeout(() => this.run(action), 0);
        this.interval = setInterval(() => this.run(action), frequency);
    }
    async run(action) {
        if (this.running !== 0) {
            validana_core_1.Log.warn(`Backend under heavy load, was still running ${this.running} times in a row.`);
            if (this.running > 3 && this.frequency * this.running > 30000) {
                validana_core_1.Log.error(`Backend under heavy load, was still running many times in a row.`);
            }
            this.running++;
            return;
        }
        try {
            this.running++;
            await action();
            this.failures = 0;
            this.running = 0;
        }
        catch (error) {
            this.failures++;
            validana_core_1.Log.warn(`Event generator caused an error ${this.failures} times in a row.`, error);
            if (this.failures > 3 && this.frequency * this.running > 30000) {
                validana_core_1.Log.error(`Event generator caused an error many times in a row.`, error);
            }
            this.running = 0;
        }
    }
    stop() {
        clearInterval(this.interval);
    }
}
exports.ServerEventGenerator = ServerEventGenerator;
