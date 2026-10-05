import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TransactionRunner } from './transaction-runner.js';
import { Counter, CounterSchema } from './counter.schema.js';
import { SequenceService } from './sequence.service.js';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>(
          'MONGODB_URI',
          'mongodb://localhost:27017/aslikaata',
        ),
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([{ name: Counter.name, schema: CounterSchema }]),
  ],
  providers: [TransactionRunner, SequenceService],
  exports: [TransactionRunner, SequenceService, MongooseModule],
})
export class DatabaseModule {}
