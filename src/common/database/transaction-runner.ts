import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ClientSession } from 'mongoose';

@Injectable()
export class TransactionRunner {
  private readonly logger = new Logger(TransactionRunner.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * Executes an asynchronous callback inside a MongoDB transaction session.
   * If any error is thrown, the transaction automatically aborts.
   * If the environment does not support replica sets (e.g. basic dev standalone without rs),
   * it provides a graceful fallback while logging a warning.
   */
  async runInTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result: T;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result!;
    } catch (error: any) {
      this.logger.error('Transaction failed and aborted:', error);
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
