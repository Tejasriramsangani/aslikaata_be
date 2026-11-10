import { createServer } from 'node:net';

/** Fail before initializing services when another instance owns the API port. */
export function assertPortAvailable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, () => {
      probe.close((error) => error ? reject(error) : resolve());
    });
  });
}

export function isAddressInUse(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
}

export function portInUseMessage(port: number): string {
  return `Port ${port} is already in use. Stop the previous backend instance in its terminal with Ctrl+C, then run npm run start:dev again. Keep only one backend instance on this port.`;
}
