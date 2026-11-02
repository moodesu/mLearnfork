import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MpvTrack } from '../../shared/mpv';

/** Bounded native subprocess; never use a shell or accept executable/flag strings from IPC. */
export type RunStudyTool = (executable: string, args: string[], signal?: AbortSignal) => Promise<Buffer>;
export const runStudyTool: RunStudyTool = (executable, args, signal) => new Promise((resolve, reject) => {
  execFile(executable, args, { encoding: 'buffer', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    shell: false, signal }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
});

/** Use packaged ffmpeg for local subtitle extraction and screenshot capture. */
export function resolveStudyFfmpegExecutable(resourcesPath = process.resourcesPath): string {
  const bundled = path.join(resourcesPath || '', 'bin', 'ffmpeg');
  if (fs.existsSync(bundled)) return bundled;
  if (process.env.SORA_STANDALONE === '1') {
    throw new Error(`Standalone Sora requires bundled ffmpeg: ${bundled}`);
  }
  return 'ffmpeg';
}

const ffmpegInput = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe'];

/** Normalize mpv metadata only; renderer-supplied media paths stay strictly absolute. */
export function externalSubtitlePath(value: string, workingDirectory: string): string {
  if (!value || value.includes('\0')) throw new Error('External subtitle path unavailable');
  if (value.startsWith('file:')) return fileURLToPath(value);
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error('External subtitle is not a local file');
  return path.isAbsolute(value) ? value : path.resolve(workingDirectory, value);
}

export function transcriptInput(mediaPath: string, track: MpvTrack): { path: string; map: string } {
  if (track.type !== 'sub' || !track.selected) throw new Error('No subtitle track selected');
  if (['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'].includes(track.codec ?? '')) {
    throw new Error('Bitmap subtitles cannot supply a transcript. Select a text subtitle track.');
  }
  if (track.external) {
    if (!track['external-filename']) throw new Error('External subtitle path unavailable');
    return { path: track['external-filename'], map: '0:s:0' };
  }
  const index = track['ff-index'];
  if (index === undefined || !Number.isInteger(index) || index < 0) {
    throw new Error('Subtitle stream index unavailable. Open an external text subtitle file.');
  }
  return { path: mediaPath, map: `0:${index}` };
}

export async function extractTranscript(input: string, map: string, run = runStudyTool, signal?: AbortSignal): Promise<string> {
  if (!/^0:(?:\d+|s:0)$/.test(map)) throw new Error('Invalid subtitle stream');
  try {
    return (await run(resolveStudyFfmpegExecutable(), [...ffmpegInput, '-i', input, '-map', map, '-f', 'srt', 'pipe:1'], signal)).toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Install ffmpeg to load subtitle lists and capture sentence screenshots.');
    throw error;
  }
}

export async function captureSentenceFrame(input: string, time: unknown, run = runStudyTool, signal?: AbortSignal): Promise<string> {
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > 7 * 86400) throw new Error('Invalid screenshot time');
  const data = await run(resolveStudyFfmpegExecutable(), [...ffmpegInput, '-ss', String(time), '-i', input,
    '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=min(960\\,iw):-2',
    '-an', '-sn', '-c:v', 'mjpeg', '-f', 'image2pipe', 'pipe:1'], signal);
  if (data.length < 3 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) throw new Error('Could not capture the selected sentence frame');
  return `data:image/jpeg;base64,${data.toString('base64')}`;
}

/** GoldenDict is a GUI app: do not wait for it to exit or kill it after a timeout. */
const launchDictionary: RunStudyTool = (executable, args) => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { shell: false, stdio: 'ignore' });
  child.once('error', reject);
  child.once('spawn', () => { child.unref(); resolve(Buffer.alloc(0)); });
});

export async function lookupGoldenDict(value: unknown, run = launchDictionary, probe = runStudyTool): Promise<void> {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /^[\s]*-/.test(value) || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Invalid dictionary lookup word');
  }
  for (const executable of ['goldendict', 'goldendict-ng']) {
    try { await run(executable, ['--main-window', value.trim()]); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const appId = 'io.github.xiaoyifang.goldendict_ng';
  // Check the app exists before launching the GUI (whose process may stay alive).
  try { await probe('flatpak', ['info', appId]); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EACCES') throw error;
    throw new Error('GoldenDict-ng was not found as a native command or installed Flatpak. ' + String(error));
  }
  await run('flatpak', ['run', appId, '--main-window', value.trim()]);
}
