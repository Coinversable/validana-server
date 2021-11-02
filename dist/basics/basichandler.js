"use strict";
/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
const requesthandler_1 = require("../core/requesthandler");
const addbasics_1 = require("./addbasics");
class BasicHandler extends (0, addbasics_1.addBasics)(requesthandler_1.RequestHandler) {
}
exports.default = BasicHandler;
