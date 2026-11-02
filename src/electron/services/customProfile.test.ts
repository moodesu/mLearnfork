import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { assertPortAvailable, CUSTOM_APP_NAME, CUSTOM_PROFILE_DIRECTORY } from './customProfile';

describe('custom build isolation', () => {
  it('uses a distinct identity', () => {
    expect(CUSTOM_APP_NAME).toBe('Sora 空');
    expect(CUSTOM_PROFILE_DIRECTORY).toBe('mlearn-custom');
    expect(CUSTOM_PROFILE_DIRECTORY).not.toBe('mlearn');
  });
  it('refuses occupied backend ports without terminating the owner', async () => {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    try {
      await expect(assertPortAvailable(address.port)).rejects.toThrow('Close mLearn');
      expect(server.listening).toBe(true);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    await expect(assertPortAvailable(address.port)).resolves.toBeUndefined();
  });
});
