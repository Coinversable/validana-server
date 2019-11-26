"use strict";
/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
const Path = require("path");
const validana_core_1 = require("@coinversable/validana-core");
const config_1 = require("../config");
class Protocol {
    constructor(worker, port, requestHandlers) {
        this.worker = worker;
        this.port = port;
        if (config_1.Config.get().VSERVER_API !== undefined) {
            if (!Protocol.depricatedVserverApiWarning) {
                Protocol.depricatedVserverApiWarning = true;
                validana_core_1.Log.warn("Loading server apis through config file is depricated. Add them as an argument to start().");
            }
            const apis = JSON.parse(config_1.Config.get().VSERVER_API);
            for (const apiName of Object.keys(apis)) {
                if (!requestHandlers.has(apiName.toLowerCase())) {
                    const apiFile = require(Path.resolve(apis[apiName]));
                    requestHandlers.set(apiName.toLowerCase(), new apiFile.default());
                }
            }
        }
        this.apiVersions = requestHandlers;
    }
}
exports.Protocol = Protocol;
Protocol.depricatedVserverApiWarning = false;
