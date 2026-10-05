import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Counter, CounterDocument } from './counter.schema.js';

@Injectable()
export class SequenceService {
  constructor(
    @InjectModel(Counter.name)
    private readonly counterModel: Model<CounterDocument>,
  ) {}

  /**
   * Generates next sequence number atomically using findOneAndUpdate.
   */
  async getNextSequence(sequenceName: string, initialOffset: number = 10000): Promise<number> {
    const counter = await this.counterModel.findByIdAndUpdate(
      sequenceName,
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return counter.seq + initialOffset;
  }

  /**
   * Generates formatted human-readable Pickup ID (e.g. AK-10001)
   */
  async generatePickupCode(): Promise<string> {
    const nextVal = await this.getNextSequence('pickupCode', 10000);
    return `AK-${nextVal}`;
  }

  /**
   * Generates formatted human-readable Invoice Number (e.g. INV-10001)
   */
  async generateInvoiceNumber(): Promise<string> {
    const nextVal = await this.getNextSequence('invoiceNumber', 10000);
    return `INV-${nextVal}`;
  }

  /**
   * Generates formatted Employee Code (e.g. EMP-101)
   */
  async generateEmployeeCode(): Promise<string> {
    const nextVal = await this.getNextSequence('employeeCode', 100);
    return `EMP-${nextVal}`;
  }
}
