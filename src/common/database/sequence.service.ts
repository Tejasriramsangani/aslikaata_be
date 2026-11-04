import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type ClientSession } from 'mongoose';
import { Counter, CounterDocument } from './counter.schema.js';

/** Uppercase letters + digits without look-alikes (no 0/O, 1/I), so codes are easy to read out loud. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Lets a caller say whether a freshly drawn code is already used (checked against that collection). */
export type CodeTakenCheck = (code: string) => Promise<boolean>;

@Injectable()
export class SequenceService {
  constructor(
    @InjectModel(Counter.name)
    private readonly counterModel: Model<CounterDocument>,
  ) {}

  /**
   * Generates next sequence number atomically using findOneAndUpdate.
   */
  async getNextSequence(
    sequenceName: string,
    initialOffset: number = 10000,
    session?: ClientSession,
  ): Promise<number> {
    const counter = await this.counterModel.findByIdAndUpdate(
      sequenceName,
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true, ...(session ? { session } : {}) },
    );
    return counter.seq + initialOffset;
  }

  /**
   * Random, non-sequential, human-readable code such as `AK-7QK4M9XD`.
   * Unlike a counter it reveals nothing about volume and cannot be guessed from a neighbouring code.
   * `isTaken` is checked so a code is never reused; the unique index on the collection is the final guard.
   */
  async generateUniqueCode(prefix: string, length: number, isTaken?: CodeTakenCheck): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      let body = '';
      for (let i = 0; i < length; i++) body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      const code = `${prefix}-${body}`;
      if (!isTaken || !(await isTaken(code))) return code;
    }
    throw new Error(`Could not generate a unique ${prefix} code`);
  }

  /**
   * Pickup ID shown to customers, e.g. AK-7QK4M9XD (random, not a counter).
   * Pass `isTaken` so it is checked against existing pickups.
   */
  async generatePickupCode(isTaken?: CodeTakenCheck): Promise<string> {
    return this.generateUniqueCode('AK', 8, isTaken);
  }

  /**
   * Invoice numbers stay sequential on purpose: accounting expects gap-free numbering (e.g. INV-10001).
   * Pass the transaction `session` so that if the invoice is rolled back, its number is given back too.
   */
  async generateInvoiceNumber(session?: ClientSession): Promise<string> {
    const nextVal = await this.getNextSequence('invoiceNumber', 10000, session);
    return `INV-${nextVal}`;
  }

  /**
   * Employee ID, e.g. EMP-7QK4M9 (random, not a counter).
   * Pass `isTaken` so it is checked against existing employee profiles.
   */
  async generateEmployeeCode(isTaken?: CodeTakenCheck): Promise<string> {
    return this.generateUniqueCode('EMP', 6, isTaken);
  }
}
