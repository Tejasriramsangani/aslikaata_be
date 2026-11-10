import { createServer, type Server } from 'node:net';
import { describe, it, expect } from 'vitest';
import { assertPortAvailable, isAddressInUse } from '../src/common/startup/port.js';

const listen = (server: Server, port: number) => new Promise<number>((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('Expected a TCP address'));
    resolve(address.port);
  });
});
const close = (server: Server) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

describe('backend startup port check', () => {
  it('rejects an occupied port without disturbing its existing server', async () => {
    const existing = createServer();
    const port = await listen(existing, 0);
    try {
      await expect(assertPortAvailable(port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(existing.listening).toBe(true);
    } finally {
      await close(existing);
    }
  });

  it('releases the probe socket so the backend can bind immediately afterward', async () => {
    const reservation = createServer();
    const port = await listen(reservation, 0);
    await close(reservation);
    await assertPortAvailable(port);
    const backend = createServer();
    try {
      await expect(listen(backend, port)).resolves.toBe(port);
    } finally {
      if (backend.listening) await close(backend);
    }
  });

  it('distinguishes a port conflict from other startup failures', () => {
    expect(isAddressInUse(Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }))).toBe(true);
    expect(isAddressInUse(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe(false);
    expect(isAddressInUse(null)).toBe(false);
  });
});
