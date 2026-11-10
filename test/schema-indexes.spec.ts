import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { CounterSchema } from '../src/common/database/counter.schema.js';
import { DivisionSchema } from '../src/modules/routing/schemas/division.schema.js';
import { VehicleSchema } from '../src/modules/routing/schemas/vehicle.schema.js';
import { HolidaySchema } from '../src/modules/routing/schemas/holiday.schema.js';
import { PickerRequestSchema, PickerRequestStatus } from '../src/modules/picker-requests/schemas/picker-request.schema.js';

describe('MongoDB startup index declarations', () => {
  it('uses the MongoDB-provided unique _id index for counters', () => {
    expect(CounterSchema.indexes().some(([keys]) => '_id' in keys)).toBe(false);
  });

  it.each([
    ['Division', DivisionSchema],
    ['Vehicle', VehicleSchema],
    ['Holiday', HolidaySchema],
    ['PickerRequest', PickerRequestSchema],
  ] as const)('%s declares each index key pattern once', (_name, schema) => {
    const keys = schema.indexes().map(([pattern]) => JSON.stringify(pattern));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('retains the partial unique constraint allowing only one pending request per mobile', () => {
    const indexes = PickerRequestSchema.indexes().filter(([keys]) => JSON.stringify(keys) === JSON.stringify({ mobile: 1 }));
    expect(indexes).toHaveLength(1);
    expect(indexes[0][1]).toMatchObject({
      unique: true,
      partialFilterExpression: { status: PickerRequestStatus.PENDING },
    });
  });

  it('retains indexes used to look up divisions, vehicle status, and holiday dates', () => {
    expect(DivisionSchema.indexes().map(([keys]) => keys)).toEqual(expect.arrayContaining([{ pincodes: 1 }, { isActive: 1 }, { boundary: '2dsphere' }]));
    expect(VehicleSchema.indexes().map(([keys]) => keys)).toContainEqual({ status: 1 });
    expect(HolidaySchema.indexes().map(([keys]) => keys)).toContainEqual({ date: 1 });
  });
});
