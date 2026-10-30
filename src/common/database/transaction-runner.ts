import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection, ClientSession } from 'mongoose';

/**
 * TransactionRunner wraps business-critical multi-document operations in a
 * MongoDB ACID transaction when the deployment supports it (replica set /
 * mongos / Atlas). On standalone MongoDB instances (typical local dev) it
 * gracefully falls back to running the work without a session, so the app
 * keeps working without needing to configure a local replica set.
 *
 * Production behaviour is unchanged – Atlas and any replica-set URI will
 * always execute inside a real transaction.
 */
@Injectable()
export class TransactionRunner {
  private readonly logger = new Logger(TransactionRunner.name);

  /** Cached result of the replica-set capability probe. null = not yet checked. */
  private supportsTransactions: boolean | null = null;

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * Returns true if the connected MongoDB deployment can run multi-document
   * transactions (i.e. is a replica set member or mongos).
   */
  private async checkTransactionSupport(): Promise<boolean> {
    if (this.supportsTransactions !== null) {
      return this.supportsTransactions;
    }

    try {
      // The driver exposes the topology type on the underlying client.
      const topology = (this.connection as any).client?.topology;
      const topologyType: string = topology?.description?.type ?? 'Unknown';

      // Replica-set topologies: 'ReplicaSetWithPrimary', 'ReplicaSetNoPrimary'
      // Sharded topology: 'Sharded'
      // Standalone: 'Single' or 'Unknown'
      const isSupported =
        topologyType === 'ReplicaSetWithPrimary' ||
        topologyType === 'ReplicaSetNoPrimary' ||
        topologyType === 'Sharded';

      this.supportsTransactions = isSupported;

      if (!isSupported) {
        this.logger.warn(
          `[DEV] MongoDB topology is "${topologyType}" — transactions are not supported on a standalone instance. ` +
            'Operations will run WITHOUT a transaction session. Data integrity is best-effort in this dev environment. ' +
            'For production, use MongoDB Atlas or a local replica set.',
        );
      }

      return isSupported;
    } catch {
      // Cannot determine topology — assume no support to stay safe.
      this.supportsTransactions = false;
      return false;
    }
  }

  /**
   * Executes an async callback inside a MongoDB transaction session when the
   * deployment supports it, or runs it directly (no session) as a graceful
   * dev fallback.
   *
   * The callback receives a `ClientSession | null`. Callers should pass the
   * session to Mongoose operations only when it is not null (Mongoose ignores
   * a `null` session option cleanly).
   */
  async runInTransaction<T>(
    work: (session: ClientSession | null) => Promise<T>,
  ): Promise<T> {
    const canUseTransaction = await this.checkTransactionSupport();

    if (!canUseTransaction) {
      // Fallback: run directly without a session.
      return work(null);
    }

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
