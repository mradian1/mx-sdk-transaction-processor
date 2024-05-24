export declare class TransactionProcessor {
    private readonly METACHAIN;
    private startDate;
    private shardIds;
    private options;
    private readonly lastProcessedNoncesInternal;
    private isRunning;
    private NETWORK_RESET_NONCE_THRESHOLD;
    private crossShardDictionary;
    start(options: TransactionProcessorOptions): Promise<void>;
    startProcessByShardblock(options: TransactionProcessorOptions): Promise<void>;
    startProcessByHyperblock(options: TransactionProcessorOptions): Promise<void>;
    private getFinalizedCrossShardScrTransactions;
    static base64Decode(str: string): string;
    private selectMany;
    private getShardTransactions;
    private getHyperblockTransactions;
    static itemToShardTransaction(item: any): ShardTransaction;
    private getShards;
    private getCurrentNonce;
    private gatewayGet;
    private getCurrentNonces;
    private getLastProcessedNonceOrCurrent;
    private getLastProcessedNonce;
    private setLastProcessedNonce;
    private onTransactionsReceived;
    private onTransactionsPending;
    private logMessage;
}
export declare enum LogTopic {
    CrossShardSmartContractResult = "CrossShardSmartContractResult",
    Debug = "Debug",
    Error = "Error"
}
export declare class ShardTransaction {
    value: string;
    data?: string;
    hash: string;
    sender: string;
    receiver: string;
    status: string;
    sourceShard: number;
    destinationShard: number;
    nonce: number;
    previousTransactionHash?: string;
    originalTransactionHash?: string;
    gasPrice?: number;
    gasLimit?: number;
    epoch: number;
    private dataDecoded;
    private getDataDecoded;
    private dataFunctionName;
    getDataFunctionName(): string | undefined;
    private dataArgs;
    getDataArgs(): string[] | undefined;
}
export declare enum TransactionProcessorMode {
    Shardblock = "Shardblock",
    Hyperblock = "Hyperblock"
}
export declare class TransactionProcessorOptions {
    gatewayUrl?: string;
    maxLookBehind?: number;
    waitForFinalizedCrossShardSmartContractResults?: boolean;
    notifyEmptyBlocks?: boolean;
    includeCrossShardStartedTransactions?: boolean;
    mode?: TransactionProcessorMode;
    onTransactionsReceived?: (shardId: number, nonce: number, round: number, timestamp: number, transactions: ShardTransaction[], statistics: TransactionStatistics, blockHash: string) => Promise<void>;
    onTransactionsPending?: (shardId: number, nonce: number, transactions: ShardTransaction[]) => Promise<void>;
    getLastProcessedNonce?: (shardId: number, currentNonce: number) => Promise<number | undefined>;
    setLastProcessedNonce?: (shardId: number, nonce: number) => Promise<void>;
    onMessageLogged?: (topic: LogTopic, message: string) => void;
    timeout?: number | undefined;
}
export declare class TransactionStatistics {
    secondsElapsed: number;
    processedNonces: number;
    noncesPerSecond: number;
    noncesLeft: number;
    secondsLeft: number;
}
export declare class CrossShardTransaction {
    transaction: ShardTransaction;
    counter: number;
    created: Date;
    constructor(transaction: ShardTransaction);
}
