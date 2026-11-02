import { describe, expect, it, vi } from 'vitest';
import { getNativeVideoCapture, registerNativeVideoCapture } from './nativeVideoCapture';

describe('native screenshot source', () => {
  it('is scoped to the current mounted player and survives stale cleanup', async () => {
    expect(getNativeVideoCapture()).toBeNull();
    const first = registerNativeVideoCapture(vi.fn(async () => 'first'));
    const capture = vi.fn(async () => 'data:image/jpeg;base64,a');
    const second = registerNativeVideoCapture(capture);
    first();
    expect(await getNativeVideoCapture()?.()).toBe('data:image/jpeg;base64,a');
    second();
    expect(getNativeVideoCapture()).toBeNull();
  });
});
