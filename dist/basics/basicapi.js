"use strict";
/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BasicPushTypes = exports.BasicRequestTypes = void 0;
var BasicRequestTypes;
(function (BasicRequestTypes) {
    BasicRequestTypes["Process"] = "process";
    BasicRequestTypes["Contracts"] = "contracts";
    BasicRequestTypes["Transaction"] = "transaction";
    BasicRequestTypes["TxStatus"] = "txStatus";
    BasicRequestTypes["Time"] = "time";
    BasicRequestTypes["Metrics"] = "metrics";
})(BasicRequestTypes = exports.BasicRequestTypes || (exports.BasicRequestTypes = {}));
var BasicPushTypes;
(function (BasicPushTypes) {
    BasicPushTypes["Transaction"] = "transaction";
})(BasicPushTypes = exports.BasicPushTypes || (exports.BasicPushTypes = {}));
