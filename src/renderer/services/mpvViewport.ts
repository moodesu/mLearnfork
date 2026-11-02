import type { MpvViewport } from '../../shared/mpv';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('renderer.services.mpvViewport');

/** A native child cannot be composited beneath HTML popups: hide it when covered. */
export function measureMpvViewport(element: HTMLElement): MpvViewport {
  return inspectMpvViewport(element).viewport;
}

export function inspectMpvViewport(element: HTMLElement): { viewport: MpvViewport; reason: string } {
  const rect = element.getBoundingClientRect();
  const width = window.innerWidth, height = window.innerHeight;
  let visible = document.visibilityState !== 'hidden' && rect.width > 0 && rect.height > 0 &&
    rect.left >= 0 && rect.top >= 0 && rect.right <= width && rect.bottom <= height;
  let reason = visible ? 'visible' : 'document-hidden-or-outside-viewport';
  const describe = (node: Element) => `${node.tagName}.${String(node.className).slice(0, 160)}`;
  for (let ancestor = element.parentElement; visible && ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden') {
      visible = false; reason = `hidden-ancestor:${describe(ancestor)}`; break;
    }
    const clip = ancestor.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (rect.top < clip.top || rect.bottom > clip.bottom)) visible = false;
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (rect.left < clip.left || rect.right > clip.right)) visible = false;
    if (!visible) reason = `clipped-by:${describe(ancestor)} bounds=${[clip.left, clip.top, clip.right, clip.bottom].join(',')}`;
  }
  // Modal backdrops and drawers are siblings of this area. Native X11 children
  // would otherwise cover them regardless of CSS z-index.
  if (visible) {
    for (const overlay of Array.from(document.querySelectorAll('.modal-overlay, [role="dialog"], .subtitle_hover.show-hover'))) {
      const area = overlay.getBoundingClientRect();
      if (area.width > 0 && area.height > 0 && area.left < rect.right && area.right > rect.left &&
          area.top < rect.bottom && area.bottom > rect.top && getComputedStyle(overlay).visibility !== 'hidden') {
        visible = false; reason = `overlay:${describe(overlay)}`;
      }
    }
    for (const x of [rect.left + 1, rect.left + rect.width / 2, rect.right - 1]) {
      for (const y of [rect.top + 1, rect.top + rect.height / 2, rect.bottom - 1]) {
        const top = document.elementFromPoint(x, y);
        if (visible && (!top || (top !== element && !element.contains(top)))) {
          visible = false; reason = `hit-test:${x},${y}:${top ? describe(top) : 'none'}`;
        }
      }
    }
  }
  return { viewport: { x: rect.left, y: rect.top, width: rect.width, height: rect.height,
    viewportWidth: width, viewportHeight: height, visible }, reason };
}

/** Event-driven, coalesced and deduplicated; no continuous layout polling. */
export function observeMpvViewport(element: HTMLElement, publish: (viewport: MpvViewport) => void): () => void {
  let frame = 0, last = '', disposed = false, lastDiagnostic = '', diagnosticCount = 0;
  const measure = () => {
    frame = 0;
    if (disposed) return;
    const inspection = inspectMpvViewport(element), value = inspection.viewport, key = JSON.stringify(value);
    const diagnostic = JSON.stringify(inspection);
    if (diagnostic !== lastDiagnostic && diagnosticCount < 100) {
      lastDiagnostic = diagnostic; diagnosticCount++;
      log.info('[EmbeddedVideo] renderer', diagnostic);
    }
    if (key !== last) { last = key; publish(value); }
  };
  const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(measure); };
  const resize = new ResizeObserver(schedule);
  resize.observe(element); resize.observe(document.documentElement);
  const mutation = new MutationObserver(schedule);
  mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
  document.addEventListener('scroll', schedule, true);
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('animationend', schedule, true);
  window.addEventListener('resize', schedule);
  measure();
  return () => {
    disposed = true; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect();
    document.removeEventListener('scroll', schedule, true);
    document.removeEventListener('visibilitychange', schedule);
    document.removeEventListener('transitionend', schedule, true);
    document.removeEventListener('animationend', schedule, true);
    window.removeEventListener('resize', schedule);
  };
}
