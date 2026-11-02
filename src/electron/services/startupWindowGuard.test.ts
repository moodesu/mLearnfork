import { describe, expect, it } from 'vitest';
import { StartupWindowGuard } from './startupWindowGuard';

describe('temporary migration window', () => {
  it('suppresses all-windows-closed quitting only while migration runs', async () => {
    const guard = new StartupWindowGuard();
    const shouldQuit = () => !guard.active;
    expect(shouldQuit()).toBe(true);
    await guard.during(async () => { expect(shouldQuit()).toBe(false); await Promise.resolve(); expect(shouldQuit()).toBe(false); });
    expect(shouldQuit()).toBe(true);
  });
  it('restores normal window lifecycle after migration failure', async () => {
    const guard = new StartupWindowGuard();
    await expect(guard.during(async () => { throw new Error('failed'); })).rejects.toThrow();
    expect(guard.active).toBe(false);
  });
});
