"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrossShardTransaction = exports.TransactionStatistics = exports.TransactionProcessorOptions = exports.TransactionProcessorMode = exports.ShardTransaction = exports.LogTopic = exports.TransactionProcessor = void 0;
const axios_1 = require("axios");
class TransactionProcessor {
    constructor() {
        this.METACHAIN = 4294967295;
        this.startDate = new Date();
        this.shardIds = [];
        this.options = new TransactionProcessorOptions();
        this.lastProcessedNoncesInternal = {};
        this.isRunning = false;
        this.NETWORK_RESET_NONCE_THRESHOLD = 10000;
        this.crossShardDictionary = {};
    }
    start(options) {
        return __awaiter(this, void 0, void 0, function* () {
            this.options = options;
            switch (options.mode) {
                case TransactionProcessorMode.Hyperblock:
                    yield this.startProcessByHyperblock(options);
                    break;
                default:
                    yield this.startProcessByShardblock(options);
            }
        });
    }
    startProcessByShardblock(options) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isRunning) {
                this.logMessage(LogTopic.Debug, 'Transaction processor is already running');
                return;
            }
            this.isRunning = true;
            const crossShardHashes = Object.keys(this.crossShardDictionary);
            for (const crossShardHash of crossShardHashes) {
                const crossShardItem = this.crossShardDictionary[crossShardHash];
                const elapsedSeconds = (new Date().getTime() - crossShardItem.created.getTime()) / 1000;
                if (elapsedSeconds > 600) {
                    this.logMessage(LogTopic.CrossShardSmartContractResult, `Pruning transaction with hash ${crossShardHash} since its elapsed time is ${elapsedSeconds} seconds`);
                    delete this.crossShardDictionary[crossShardHash];
                }
            }
            try {
                this.startDate = new Date();
                this.shardIds = yield this.getShards();
                this.logMessage(LogTopic.Debug, `shardIds: ${this.shardIds}`);
                const startLastProcessedNonces = {};
                let reachedTip;
                const currentNonces = yield this.getCurrentNonces();
                do {
                    reachedTip = true;
                    for (const shardId of this.shardIds) {
                        const currentNonce = currentNonces[shardId];
                        let lastProcessedNonce = yield this.getLastProcessedNonceOrCurrent(shardId, currentNonce);
                        this.logMessage(LogTopic.Debug, `shardId: ${shardId}, currentNonce: ${currentNonce}, lastProcessedNonce: ${lastProcessedNonce}`);
                        if (lastProcessedNonce === currentNonce) {
                            this.logMessage(LogTopic.Debug, 'lastProcessedNonce === currentNonce');
                            continue;
                        }
                        // this is to handle the situation where the current nonce is reset
                        // (e.g. devnet/testnet reset where the nonces start again from zero)
                        if (lastProcessedNonce > currentNonce + this.NETWORK_RESET_NONCE_THRESHOLD) {
                            this.logMessage(LogTopic.Debug, `Detected network reset. Setting last processed nonce to ${currentNonce} for shard ${shardId}`);
                            lastProcessedNonce = currentNonce;
                        }
                        if (lastProcessedNonce > currentNonce) {
                            this.logMessage(LogTopic.Debug, 'lastProcessedNonce > currentNonce');
                            continue;
                        }
                        if (options.maxLookBehind && currentNonce - lastProcessedNonce > options.maxLookBehind) {
                            lastProcessedNonce = currentNonce - options.maxLookBehind;
                        }
                        if (!startLastProcessedNonces[shardId]) {
                            startLastProcessedNonces[shardId] = lastProcessedNonce;
                        }
                        const nonce = lastProcessedNonce + 1;
                        const transactionsResult = yield this.getShardTransactions(shardId, nonce);
                        if (transactionsResult === undefined) {
                            this.logMessage(LogTopic.Debug, 'transactionsResult === undefined');
                            continue;
                        }
                        const blockHash = transactionsResult.blockHash;
                        const transactions = transactionsResult.transactions;
                        reachedTip = false;
                        const validTransactions = [];
                        const crossShardTransactions = [];
                        if (this.options.waitForFinalizedCrossShardSmartContractResults === true) {
                            const crossShardTransactions = this.getFinalizedCrossShardScrTransactions(shardId, transactions);
                            for (const crossShardTransaction of crossShardTransactions) {
                                validTransactions.push(crossShardTransaction);
                            }
                        }
                        for (const transaction of transactions) {
                            // we only care about transactions that are finalized in the given shard
                            if (transaction.destinationShard !== shardId && !options.includeCrossShardStartedTransactions) {
                                this.logMessage(LogTopic.Debug, `transaction with hash '${transaction.hash}' not on destination shard. Skipping`);
                                continue;
                            }
                            // we skip transactions that are cross shard and still pending for smart-contract results
                            if (this.crossShardDictionary[transaction.hash]) {
                                this.logMessage(LogTopic.Debug, `transaction with hash '${transaction.hash}' is still awaiting cross shard SCRs. Skipping`);
                                crossShardTransactions.push(transaction);
                                continue;
                            }
                            validTransactions.push(transaction);
                        }
                        if (validTransactions.length > 0 || options.notifyEmptyBlocks === true) {
                            this.logMessage(LogTopic.CrossShardSmartContractResult, `crossShardTransactionsCounterDictionary items: ${Object.keys(this.crossShardDictionary).length}`);
                            const statistics = new TransactionStatistics();
                            statistics.secondsElapsed = (new Date().getTime() - this.startDate.getTime()) / 1000;
                            statistics.processedNonces = lastProcessedNonce - startLastProcessedNonces[shardId];
                            statistics.noncesPerSecond = statistics.processedNonces / statistics.secondsElapsed;
                            statistics.noncesLeft = currentNonce - lastProcessedNonce;
                            statistics.secondsLeft = statistics.noncesLeft / statistics.noncesPerSecond * 1.1;
                            this.logMessage(LogTopic.Debug, `For shardId ${shardId} and nonce ${nonce}, notifying transactions with hashes ${validTransactions.map(x => x.hash)}`);
                            yield this.onTransactionsReceived(shardId, nonce, transactionsResult.round, transactionsResult.timestamp, validTransactions, statistics, blockHash);
                        }
                        if (crossShardTransactions.length > 0) {
                            yield this.onTransactionsPending(shardId, nonce, transactionsResult.round, transactionsResult.timestamp, crossShardTransactions);
                        }
                        this.logMessage(LogTopic.Debug, `Setting last processed nonce for shardId ${shardId} to ${nonce}`);
                        yield this.setLastProcessedNonce(shardId, nonce);
                    }
                } while (!reachedTip);
            }
            finally {
                this.isRunning = false;
            }
        });
    }
    startProcessByHyperblock(options) {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isRunning) {
                this.logMessage(LogTopic.Debug, 'Transaction processor is already running');
                return;
            }
            this.isRunning = true;
            try {
                this.shardIds = [this.METACHAIN];
                this.startDate = new Date();
                let startLastProcessedNonce = 0;
                let reachedTip;
                const currentNonces = yield this.getCurrentNonces();
                const currentNonce = currentNonces[this.METACHAIN];
                do {
                    reachedTip = true;
                    let lastProcessedNonce = yield this.getLastProcessedNonceOrCurrent(this.METACHAIN, currentNonce);
                    this.logMessage(LogTopic.Debug, `currentNonce: ${currentNonce}, lastProcessedNonce: ${lastProcessedNonce}`);
                    if (lastProcessedNonce === currentNonce) {
                        continue;
                    }
                    // this is to handle the situation where the current nonce is reset
                    // (e.g. devnet/testnet reset where the nonces start again from zero)
                    if (lastProcessedNonce > currentNonce + this.NETWORK_RESET_NONCE_THRESHOLD) {
                        this.logMessage(LogTopic.Debug, `Detected network reset. Setting last processed nonce to ${currentNonce}`);
                        lastProcessedNonce = currentNonce;
                    }
                    if (lastProcessedNonce > currentNonce) {
                        this.logMessage(LogTopic.Debug, 'lastProcessedNonce > currentNonce');
                        continue;
                    }
                    if (options.maxLookBehind && currentNonce - lastProcessedNonce > options.maxLookBehind) {
                        lastProcessedNonce = currentNonce - options.maxLookBehind;
                    }
                    if (!startLastProcessedNonce) {
                        startLastProcessedNonce = lastProcessedNonce;
                    }
                    const nonce = lastProcessedNonce + 1;
                    const transactionsResult = yield this.getHyperblockTransactions(nonce);
                    if (transactionsResult === undefined) {
                        this.logMessage(LogTopic.Debug, 'transactionsResult === undefined');
                        continue;
                    }
                    const { blockHash, transactions } = transactionsResult;
                    reachedTip = false;
                    const transactionsByShard = new Map();
                    for (const transaction of transactions) {
                        const shardId = transaction.destinationShard;
                        const shardTransactions = (_a = transactionsByShard.get(shardId)) !== null && _a !== void 0 ? _a : [];
                        shardTransactions.push(transaction);
                        transactionsByShard.set(shardId, shardTransactions);
                    }
                    for (const shardId of transactionsByShard.keys()) {
                        const transactions = (_b = transactionsByShard.get(shardId)) !== null && _b !== void 0 ? _b : [];
                        if (transactions.length > 0 || options.notifyEmptyBlocks === true) {
                            const statistics = new TransactionStatistics();
                            statistics.secondsElapsed = (new Date().getTime() - this.startDate.getTime()) / 1000;
                            statistics.processedNonces = lastProcessedNonce - startLastProcessedNonce;
                            statistics.noncesPerSecond = statistics.processedNonces / statistics.secondsElapsed;
                            statistics.noncesLeft = currentNonce - lastProcessedNonce;
                            statistics.secondsLeft = statistics.noncesLeft / statistics.noncesPerSecond * 1.1;
                            this.logMessage(LogTopic.Debug, `For shardId ${shardId} and nonce ${nonce}, notifying transactions with hashes ${transactions.map(x => x.hash)}`);
                            yield this.onTransactionsReceived(shardId, nonce, transactionsResult.round, transactionsResult.timestamp, transactions, statistics, blockHash);
                        }
                    }
                    this.logMessage(LogTopic.Debug, `Setting last processed nonce to ${nonce}`);
                    yield this.setLastProcessedNonce(this.METACHAIN, nonce);
                } while (!reachedTip);
            }
            finally {
                this.isRunning = false;
            }
        });
    }
    getFinalizedCrossShardScrTransactions(shardId, transactions) {
        const crossShardTransactions = [];
        // pass 1: we add pending transactions in the dictionary from current shard to another one
        for (const transaction of transactions) {
            if (transaction.originalTransactionHash && transaction.sourceShard === shardId && transaction.destinationShard !== shardId) {
                let crossShardItem = this.crossShardDictionary[transaction.originalTransactionHash];
                if (!crossShardItem) {
                    this.logMessage(LogTopic.CrossShardSmartContractResult, `Creating dictionary for original tx hash ${transaction.originalTransactionHash}`);
                    const originalTransaction = transactions.find(x => x.hash === transaction.originalTransactionHash);
                    if (originalTransaction) {
                        crossShardItem = new CrossShardTransaction(originalTransaction);
                        this.crossShardDictionary[transaction.originalTransactionHash] = crossShardItem;
                    }
                    else {
                        this.logMessage(LogTopic.CrossShardSmartContractResult, `Could not identify transaction with hash ${transaction.originalTransactionHash} in transaction list`);
                        continue;
                    }
                }
                // if '@ok', ignore
                if (transaction.data) {
                    const data = TransactionProcessor.base64Decode(transaction.data);
                    if (data === '@6f6b') {
                        this.logMessage(LogTopic.CrossShardSmartContractResult, `Not incrementing counter for cross-shard SCR, original tx hash ${transaction.originalTransactionHash}, tx hash ${transaction.hash} since the data is @ok (${data})`);
                        continue;
                    }
                }
                crossShardItem.counter++;
                this.logMessage(LogTopic.CrossShardSmartContractResult, `Detected new cross-shard SCR for original tx hash ${transaction.originalTransactionHash}, tx hash ${transaction.hash}, counter = ${crossShardItem.counter}`);
                this.crossShardDictionary[transaction.originalTransactionHash] = crossShardItem;
            }
        }
        // pass 2: we delete pending transactions in the dictionary from another shard to current shard
        for (const transaction of transactions) {
            if (transaction.originalTransactionHash && transaction.sourceShard !== shardId && transaction.destinationShard === shardId) {
                const crossShardItem = this.crossShardDictionary[transaction.originalTransactionHash];
                if (!crossShardItem) {
                    this.logMessage(LogTopic.CrossShardSmartContractResult, `No counter available for cross-shard SCR, original tx hash ${transaction.originalTransactionHash}, tx hash ${transaction.hash}`);
                    continue;
                }
                // if '@ok', ignore
                if (transaction.data) {
                    const data = TransactionProcessor.base64Decode(transaction.data);
                    if (data === '@6f6b') {
                        this.logMessage(LogTopic.CrossShardSmartContractResult, `Not decrementing counter for cross-shard SCR, original tx hash ${transaction.originalTransactionHash}, tx hash ${transaction.hash} since the data is @ok (${data})`);
                        continue;
                    }
                }
                crossShardItem.counter--;
                this.logMessage(LogTopic.CrossShardSmartContractResult, `Finalized cross-shard SCR for original tx hash ${transaction.originalTransactionHash}, tx hash ${transaction.hash}, counter = ${crossShardItem.counter}`);
                this.crossShardDictionary[transaction.originalTransactionHash] = crossShardItem;
            }
        }
        // step 3. If the counter reached zero, we take the value out
        const crossShardDictionaryHashes = Object.keys(this.crossShardDictionary);
        for (const transactionHash of crossShardDictionaryHashes) {
            const crossShardItem = this.crossShardDictionary[transactionHash];
            if (crossShardItem.counter === 0) {
                this.logMessage(LogTopic.CrossShardSmartContractResult, `Completed cross-shard transaction for original tx hash ${transactionHash}`);
                // we only add it to the cross shard transactions if it isn't already in the list of completed transactions
                if (!transactions.some(transaction => transaction.hash === transactionHash)) {
                    crossShardTransactions.push(crossShardItem.transaction);
                }
                delete this.crossShardDictionary[transactionHash];
            }
        }
        return crossShardTransactions;
    }
    static base64Decode(str) {
        return Buffer.from(str, 'base64').toString('binary');
    }
    selectMany(array, predicate) {
        const result = [];
        for (const item of array) {
            result.push(...predicate(item));
        }
        return result;
    }
    getShardTransactions(shardId, nonce) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield this.gatewayGet(`block/${shardId}/by-nonce/${nonce}?withTxs=true`);
            if (!result || !result.block) {
                this.logMessage(LogTopic.Debug, `Block for shardId ${shardId} and nonce ${nonce} is undefined or block not available`);
                return undefined;
            }
            const round = result.block.round;
            const timestamp = result.block.timestamp;
            if (result.block.miniBlocks === undefined) {
                this.logMessage(LogTopic.Debug, `Block for shardId ${shardId} and nonce ${nonce} does not contain any miniBlocks`);
                return { blockHash: result.block.hash, round, timestamp, transactions: [] };
            }
            const transactions = this.selectMany(result.block.miniBlocks, (item) => { var _a; return (_a = item.transactions) !== null && _a !== void 0 ? _a : []; })
                .map((item) => TransactionProcessor.itemToShardTransaction(item));
            return { blockHash: result.block.hash, round, timestamp, transactions };
        });
    }
    getHyperblockTransactions(nonce) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield this.gatewayGet(`hyperblock/by-nonce/${nonce}`);
            const round = result.hyperblock.round;
            const timestamp = result.hyperblock.timestamp;
            if (!result) {
                return undefined;
            }
            const { hyperblock: { hash, transactions } } = result;
            if (transactions === undefined) {
                return { blockHash: hash, round, timestamp, transactions: [] };
            }
            const shardTransactions = transactions
                .map((item) => TransactionProcessor.itemToShardTransaction(item));
            return { blockHash: hash, round, timestamp, transactions: shardTransactions };
        });
    }
    static itemToShardTransaction(item) {
        const transaction = new ShardTransaction();
        transaction.data = item.data;
        transaction.sender = item.sender;
        transaction.receiver = item.receiver;
        transaction.sourceShard = item.sourceShard;
        transaction.destinationShard = item.destinationShard;
        transaction.hash = item.hash;
        transaction.nonce = item.nonce;
        transaction.status = item.status;
        transaction.value = item.value;
        transaction.originalTransactionHash = item.originalTransactionHash;
        transaction.gasPrice = item.gasPrice;
        transaction.gasLimit = item.gasLimit;
        transaction.epoch = item.epoch;
        return transaction;
    }
    getShards() {
        return __awaiter(this, void 0, void 0, function* () {
            const networkConfig = yield this.gatewayGet('network/config');
            const shardCount = networkConfig.config.erd_num_shards_without_meta;
            const result = [];
            for (let i = 0; i < shardCount; i++) {
                result.push(i);
            }
            result.push(this.METACHAIN);
            return result;
        });
    }
    getCurrentNonce(shardId) {
        return __awaiter(this, void 0, void 0, function* () {
            const shardInfo = yield this.gatewayGet(`network/status/${shardId}`);
            return shardInfo.status.erd_nonce;
        });
    }
    gatewayGet(path) {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            const gatewayUrl = (_a = this.options.gatewayUrl) !== null && _a !== void 0 ? _a : 'https://gateway.multiversx.com';
            const fullUrl = `${gatewayUrl}/${path}`;
            try {
                const result = yield axios_1.default.get(fullUrl, {
                    timeout: (_b = this.options.timeout) !== null && _b !== void 0 ? _b : 5000,
                });
                return result.data.data;
            }
            catch (error) {
                throw new Error(`Error when getting from gateway url ${fullUrl}: ${error}`);
            }
        });
    }
    getCurrentNonces() {
        return __awaiter(this, void 0, void 0, function* () {
            const currentNonces = yield Promise.all(this.shardIds.map(shardId => this.getCurrentNonce(shardId)));
            const result = {};
            for (const [index, shardId] of this.shardIds.entries()) {
                result[shardId] = currentNonces[index];
            }
            return result;
        });
    }
    getLastProcessedNonceOrCurrent(shardId, currentNonce) {
        return __awaiter(this, void 0, void 0, function* () {
            let lastProcessedNonce = yield this.getLastProcessedNonce(shardId, currentNonce);
            if (lastProcessedNonce === null || lastProcessedNonce === undefined) {
                lastProcessedNonce = currentNonce - 1;
                yield this.setLastProcessedNonce(shardId, lastProcessedNonce);
            }
            return lastProcessedNonce;
        });
    }
    getLastProcessedNonce(shardId, currentNonce) {
        return __awaiter(this, void 0, void 0, function* () {
            const getLastProcessedNonceFunc = this.options.getLastProcessedNonce;
            if (!getLastProcessedNonceFunc) {
                return this.lastProcessedNoncesInternal[shardId];
            }
            return yield getLastProcessedNonceFunc(shardId, currentNonce);
        });
    }
    setLastProcessedNonce(shardId, nonce) {
        return __awaiter(this, void 0, void 0, function* () {
            const setLastProcessedNonceFunc = this.options.setLastProcessedNonce;
            if (!setLastProcessedNonceFunc) {
                this.lastProcessedNoncesInternal[shardId] = nonce;
                return;
            }
            yield setLastProcessedNonceFunc(shardId, nonce);
        });
    }
    onTransactionsReceived(shardId, nonce, round, timestamp, transactions, statistics, blockHash) {
        return __awaiter(this, void 0, void 0, function* () {
            const onTransactionsReceivedFunc = this.options.onTransactionsReceived;
            if (onTransactionsReceivedFunc) {
                yield onTransactionsReceivedFunc(shardId, nonce, round, timestamp, transactions, statistics, blockHash);
            }
        });
    }
    onTransactionsPending(shardId, nonce, round, timestamp, transactions) {
        return __awaiter(this, void 0, void 0, function* () {
            const onTransactionsPendingFunc = this.options.onTransactionsPending;
            if (onTransactionsPendingFunc) {
                yield onTransactionsPendingFunc(shardId, nonce, transactions);
            }
        });
    }
    logMessage(topic, message) {
        const onMessageLogged = this.options.onMessageLogged;
        if (onMessageLogged) {
            onMessageLogged(topic, message);
        }
    }
}
exports.TransactionProcessor = TransactionProcessor;
var LogTopic;
(function (LogTopic) {
    LogTopic["CrossShardSmartContractResult"] = "CrossShardSmartContractResult";
    LogTopic["Debug"] = "Debug";
    LogTopic["Error"] = "Error";
})(LogTopic = exports.LogTopic || (exports.LogTopic = {}));
class ShardTransaction {
    constructor() {
        this.value = '';
        this.hash = '';
        this.sender = '';
        this.receiver = '';
        this.status = '';
        this.sourceShard = 0;
        this.destinationShard = 0;
        this.nonce = 0;
        this.epoch = 0;
    }
    getDataDecoded() {
        if (!this.dataDecoded) {
            if (this.data) {
                this.dataDecoded = TransactionProcessor.base64Decode(this.data);
            }
        }
        return this.dataDecoded;
    }
    getDataFunctionName() {
        if (!this.dataFunctionName) {
            const decoded = this.getDataDecoded();
            if (decoded) {
                this.dataFunctionName = decoded.split('@')[0];
            }
        }
        return this.dataFunctionName;
    }
    getDataArgs() {
        if (!this.dataArgs) {
            const decoded = this.getDataDecoded();
            if (decoded) {
                this.dataArgs = decoded.split('@').splice(1);
            }
        }
        return this.dataArgs;
    }
}
exports.ShardTransaction = ShardTransaction;
var TransactionProcessorMode;
(function (TransactionProcessorMode) {
    TransactionProcessorMode["Shardblock"] = "Shardblock";
    TransactionProcessorMode["Hyperblock"] = "Hyperblock";
})(TransactionProcessorMode = exports.TransactionProcessorMode || (exports.TransactionProcessorMode = {}));
class TransactionProcessorOptions {
}
exports.TransactionProcessorOptions = TransactionProcessorOptions;
class TransactionStatistics {
    constructor() {
        this.secondsElapsed = 0;
        this.processedNonces = 0;
        this.noncesPerSecond = 0;
        this.noncesLeft = 0;
        this.secondsLeft = 0;
    }
}
exports.TransactionStatistics = TransactionStatistics;
class CrossShardTransaction {
    constructor(transaction) {
        this.counter = 0;
        this.created = new Date();
        this.transaction = transaction;
    }
}
exports.CrossShardTransaction = CrossShardTransaction;
