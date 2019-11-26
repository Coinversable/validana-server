/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

/**
 * Some basic requests, recommended for any RequestHandler:
 * Process: ProcessRequest, no data
 * Contracts: no request data | string, Contract[]
 * Transaction: TxRequest, TxResponseOrPush | undefined, may result in pushtransaction: Transaction with data TxResponseOrPush
 * TxStatus: TxRequest, TxStatusResponse, may result in pushtransaction: Transaction with data TxResponseOrPush
 * Time: no request data, number | undefined
 */
export enum BasicRequestTypes {
	Process = "process",
	Contracts = "contracts",
	Transaction = "transaction",
	TxStatus = "txStatus",
	Time = "time",
	Metrics = "metrics"
}

/**
 * Possible push actions with their data:
 * Transaction: TxResponseOrPush
 */
export enum BasicPushTypes {
	Transaction = "transaction"
}

//The possible request, reponse and push data you can expect.
export type RequestData = ProcessRequest | TxRequest | undefined;
export type ReponseData = Contract[] | TxResponseOrPush | undefined;
export type PushData = TxResponseOrPush;

export interface ProcessRequest {
	/** The transaction (in base64 format, same as transaction inside a block) */
	base64tx: string;
	/** Optional info about when it was created. */
	createTs?: number;
	/** Do not return till the transation has been processed. In this case the status code will be 200/422 depending on the result. */
	wait?: boolean;
}

export interface TxRequest {
	/** Transaction id(s) (hex) */
	txId: string | string[];
	/** Return what is available. Send the rest as a push message when they are? (websocket only) */
	push?: boolean;
	/** Do not return till everything is available? If true 'push' will be ignored. */
	wait?: boolean;
}

export interface Contract {
	type: string;
	hash: string;
	version: string;
	description: string;
	template: {
		[fieldType: string]: FieldType;
	};
	validanaVersion: number;
}

export interface FieldType {
	type: string; //Field Type
	desc: string; //Field suggested description
	name: string; //Field suggested name
}

export type TxStatusResponse = string | undefined | TxStatusesResponse[];
export type TxResponse = TxResponseOrPush | undefined | TxResponseOrPush[];

export interface TxStatusesResponse {
	id: string;
	status: string;
	message: string;
}

export interface TxResponseOrPush {
	//Transaction info
	id: string;
	version: number;
	contractHash: string;
	validTill: number;
	payload: any;
	publicKey: string;
	signature: string;
	status: string;
	createTs?: number;
	//Processed transaction info (if valid)
	sender: string | null;
	contractType: string | null;
	message: string | null;
	blockId: number | null;
	positionInBlock: number | null;
	processedTs: number | null;
	//Optional info once processed
	receiver: string | null;
}