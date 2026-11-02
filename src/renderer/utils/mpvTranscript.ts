import type { Subtitle } from '../../shared/types';

/** FFmpeg normalises external and embedded text tracks to SRT. Never render markup. */
export function parseMpvTranscript(content: string): Subtitle[] {
  const cues: Subtitle[] = [];
  const time = (h: string, m: string, s: string, ms: string) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  for (const block of content.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) continue;
    const match = lines[index].match(/^(\d+):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!match) continue;
    const start = time(match[1], match[2], match[3], match[4]);
    const end = time(match[5], match[6], match[7], match[8]);
    const text = lines.slice(index + 1).join('\n').replace(/<[^>]*>|\{[^}]*\}/g, '').trim();
    if (text && Number.isFinite(start) && Number.isFinite(end) && end > start) cues.push({ start, end, text });
    if (cues.length > 20000) throw new Error('Subtitle track exceeds 20,000 lines');
  }
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function activeTranscriptIndex(cues: Subtitle[], position: number, delay: number): number {
  const time = position - delay;
  let lo = 0; let hi = cues.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (cues[mid].start <= time) lo = mid + 1; else hi = mid; }
  for (let i = lo - 1; i >= 0; i--) if (time < cues[i].end) return i;
  return -1;
}

export function delayedCue(cue: Subtitle, delay: number): Subtitle {
  return { ...cue, start: cue.start + delay, end: cue.end + delay };
}

export function sentenceFrameTime(start: number | undefined, end: number | undefined): number | undefined {
  if (start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= 0) return undefined;
  return Math.max(0, (start + end) / 2);
}

export function transcriptTime(seconds: number): string {
  const time = Math.max(0, Math.floor(seconds));
  return `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`;
}
