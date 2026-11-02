import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectMpvViewport, measureMpvViewport, observeMpvViewport } from './mpvViewport';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
function fixture() {
  const element = document.createElement('div'); document.body.append(element);
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 50, 400, 225));
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(element);
  return element;
}
describe('embedded video geometry', () => {
  it('keeps video visible with a definition contained beside or below it', () => {
    const element = fixture(), popup = document.createElement('div');
    popup.className = 'subtitle_hover show-hover'; document.body.append(popup);
    const bounds = vi.spyOn(popup, 'getBoundingClientRect');
    bounds.mockReturnValue(new DOMRect(440, 60, 200, 300));
    expect(measureMpvViewport(element).visible).toBe(true);
    bounds.mockReturnValue(new DOMRect(20, 300, 400, 100));
    expect(measureMpvViewport(element).visible).toBe(true);
  });
  it('identifies the visibility guard without logging page text', () => {
    const element = fixture();
    expect(inspectMpvViewport(element).reason).toBe('visible');
    vi.mocked(document.elementFromPoint).mockReturnValue(document.body);
    expect(inspectMpvViewport(element).reason).toContain('hit-test:');
    vi.mocked(document.elementFromPoint).mockReturnValue(element);
    document.body.style.overflow = 'hidden';
    document.body.style.overflowY = 'hidden';
    expect(inspectMpvViewport(element).reason).toContain('clipped-by:BODY');
    document.body.removeAttribute('style');
  });
  it('reports CSS geometry without applying desktop scale a second time', () => {
    const element = fixture();
    const result = measureMpvViewport(element);
    expect(result).toMatchObject({ x: 20, y: 50, width: 400, height: 225, viewportWidth: window.innerWidth, visible: true });
  });
  it('hides the native child under HTML overlays or when scrolled offscreen', () => {
    const element = fixture();
    vi.mocked(document.elementFromPoint).mockReturnValue(document.body);
    expect(measureMpvViewport(element).visible).toBe(false);
    vi.mocked(document.elementFromPoint).mockReturnValue(element);
    vi.mocked(element.getBoundingClientRect).mockReturnValue(new DOMRect(20, -10, 400, 225));
    expect(measureMpvViewport(element).visible).toBe(false);
  });
  it('publishes once initially and stops observing on cleanup', () => {
    const element = fixture(), publish = vi.fn();
    const stop = observeMpvViewport(element, publish);
    expect(publish).toHaveBeenCalledOnce();
    stop();
    window.dispatchEvent(new Event('resize'));
    expect(publish).toHaveBeenCalledOnce();
  });
  it('hides under a small word popup even between the hit-test points', () => {
    const element = fixture(), popup = document.createElement('div');
    popup.className = 'subtitle_hover show-hover'; document.body.append(popup);
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 80, 30, 30));
    expect(measureMpvViewport(element).visible).toBe(false);
    popup.remove();
    expect(measureMpvViewport(element).visible).toBe(true);
  });
});
