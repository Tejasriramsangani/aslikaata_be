import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomersService, MAX_SAVED_ADDRESSES } from '../src/modules/customers/customers.service.js';

const dto = (extra: any = {}): any => ({
  line1: 'Benz Circle, Vijayawada',
  city: 'Vijayawada',
  state: 'Andhra Pradesh',
  pincode: '520010',
  coordinates: [80.6469, 16.5033],
  ...extra,
});

function build(opts: { count?: number; existing?: any; found?: any; next?: any } = {}) {
  const addressModel: any = {
    findOne: vi.fn((filter: any) => {
      // setPrimary / delete look up by _id; addAddress dedupe uses the $near filter
      if (filter?.location) return Promise.resolve(opts.existing ?? null);
      const result = filter?._id ? opts.found ?? null : opts.next ?? null;
      return Object.assign(Promise.resolve(result), { sort: async () => opts.next ?? null });
    }),
    findOneAndDelete: vi.fn(async () => opts.found ?? null),
    countDocuments: vi.fn(async () => opts.count ?? 0),
    updateMany: vi.fn(async () => ({})),
    create: vi.fn(async (doc: any) => ({ _id: 'new-address', ...doc })),
  };
  return { service: new CustomersService({} as any, addressModel), addressModel };
}

describe('Saved addresses: labels, primary, limit', () => {
  it('stores the label, and a name only for "Other"', async () => {
    const home = build();
    await home.service.addAddress('u1', dto({ label: 'HOME', labelName: 'ignored' }));
    expect(home.addressModel.create.mock.calls[0][0]).toMatchObject({ label: 'HOME', labelName: '' });

    const other = build();
    await other.service.addAddress('u1', dto({ label: 'OTHER', labelName: " Mom's house " }));
    expect(other.addressModel.create.mock.calls[0][0]).toMatchObject({ label: 'OTHER', labelName: "Mom's house" });
  });

  it('the first address is primary; later ones are not unless asked', async () => {
    const first = build({ count: 0 });
    await first.service.addAddress('u1', dto({ label: 'HOME' }));
    expect(first.addressModel.create.mock.calls[0][0].isDefault).toBe(true);

    const second = build({ count: 1 });
    await second.service.addAddress('u1', dto({ label: 'WORK' }));
    expect(second.addressModel.create.mock.calls[0][0].isDefault).toBe(false);
    expect(second.addressModel.updateMany).not.toHaveBeenCalled();
  });

  it(`refuses a ${MAX_SAVED_ADDRESSES + 1}th address, but still reuses an existing one`, async () => {
    const full = build({ count: MAX_SAVED_ADDRESSES });
    await expect(full.service.addAddress('u1', dto({ label: 'OTHER' }))).rejects.toThrow(BadRequestException);
    await expect(full.service.addAddress('u1', dto({ label: 'OTHER' }))).rejects.toThrow(/up to 3 addresses/);
    expect(full.addressModel.create).not.toHaveBeenCalled();

    const existing: any = { _id: 'same-door', label: 'OTHER', labelName: '', save: vi.fn(async () => undefined) };
    const again = build({ count: MAX_SAVED_ADDRESSES, existing });
    const result: any = await again.service.addAddress('u1', dto({ label: 'HOME' }));
    expect(result).toBe(existing);
    expect(result.label).toBe('HOME');
    expect(existing.save).toHaveBeenCalled();
  });

  it('making an address primary clears the primary flag on the others', async () => {
    const address: any = { _id: 'a2', isDefault: false, save: vi.fn(async () => undefined) };
    const { service, addressModel } = build({ found: address });
    const result = await service.setPrimaryAddress('u1', 'a2');

    expect(result.isDefault).toBe(true);
    expect(addressModel.updateMany).toHaveBeenCalledWith({ userId: 'u1', _id: { $ne: 'a2' } }, { isDefault: false });
    expect(address.save).toHaveBeenCalled();
  });

  it('cannot make someone else\'s (or a missing) address primary', async () => {
    const { service } = build({ found: null });
    await expect(service.setPrimaryAddress('u1', 'nope')).rejects.toThrow(NotFoundException);
  });

  it('deleting the primary address promotes the most recent remaining one', async () => {
    const next: any = { _id: 'a3', isDefault: false, save: vi.fn(async () => undefined) };
    const { service } = build({ found: { _id: 'a1', isDefault: true }, next });
    await service.deleteAddress('u1', 'a1');
    expect(next.isDefault).toBe(true);
    expect(next.save).toHaveBeenCalled();
  });

  it('deleting a non-primary address leaves the primary alone', async () => {
    const next: any = { _id: 'a3', isDefault: true, save: vi.fn(async () => undefined) };
    const { service } = build({ found: { _id: 'a2', isDefault: false }, next });
    await service.deleteAddress('u1', 'a2');
    expect(next.save).not.toHaveBeenCalled();
  });
});
