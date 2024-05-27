import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TransactionProcessor, ShardTransaction, TransactionProcessorMode } from '../../src/transaction.processor';
import { Locker } from '../utils/locker';

@Injectable()
export class TransactionProcessorService {
  private readonly logger: Logger;
  private lastNonce: number | undefined;
  private readonly transactionProcessor = new TransactionProcessor();
  constructor(
  ) {
    this.logger = new Logger(TransactionProcessorService.name);
  }

  @Cron('*/1 * * * * *')
  async handleNewMultiversxTransactions() {
    Locker.lock('newMultiversxTransactions', async () => {
        await this.transactionProcessor.start({
          mode: TransactionProcessorMode.Shardblock,
          gatewayUrl: 'https://gateway.multiversx.com', //'https://api.multiversx.com', //'https://gateway.multiversx.com', // mainnet
          getLastProcessedNonce: async (_shardId: number, _currentNonce: number) => {
            // In ProcessByHyperblockTransactions shardId will always be METACHAIN
            return this.lastNonce;
          },
          setLastProcessedNonce: async(_shardId: number, nonce: number) => {
            // In ProcessByHyperblockTransactions shardId will always be METACHAIN
            this.lastNonce = nonce;
          },
          onTransactionsReceived: async (shardId: number, nonce: number, round: number, timestamp: number, transactions: ShardTransaction[]) => {
            console.log(`Received ${transactions.length} transactions on shard ${shardId} and nonce ${nonce} at round ${round} (timestamp: ${timestamp})`);
          }
        });
    });
  }

}
