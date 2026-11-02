import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { INITIAL_MPV_STATE, type MpvState } from '../../../shared/mpv';
import type { useSubtitles } from '../../hooks/useSubtitles';
import { getNativeVideoCapture } from '../../services/nativeVideoCapture';

const mock = vi.hoisted(() => ({
  callback: null as ((state: MpvState) => void) | null,
  open: vi.fn(async () => {}), close: vi.fn(async () => {}), control: vi.fn(async () => {}),
  embeddingAvailable: vi.fn(async () => false), setViewport: vi.fn(async () => {}),
  addSubtitle: vi.fn(async () => {}), screenshot: vi.fn(async () => 'data:image/jpeg;base64,frame'),
  screenshotAt: vi.fn(async () => 'data:image/jpeg;base64,selected'),
  transcript: vi.fn(async () => ({ trackId: 7 as number | null, content: '1\n00:01:28,200 --> 00:01:29,950\nselected sentence\n\n2\n00:02:00,000 --> 00:02:01,000\nnext sentence' })),
  lookupDictionary: vi.fn(async () => {}),
  unsubscribe: vi.fn(), savePosition: vi.fn(async () => {}),
}));
vi.mock('../../../shared/bridges', () => ({ getBridge: () => ({ mpv: {
  ...mock, onState: (callback: (state: MpvState) => void) => { mock.callback = callback; return mock.unsubscribe; },
} }) }));
vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }),
  useLanguage: () => ({ getLanguageFeatures: () => ({ tokenizerCapabilities: { providesLemmas: true } }) }),
}));
vi.mock('../subtitle/SubtitleContainer', () => ({ SubtitleContainer: (props: { containedHover?: boolean }) =>
  <div data-contained-hover={String(props.containedHover)} /> }));
vi.mock('../../services/thumbnailService', () => ({
  getRecentItems: async () => [{ path: '/tmp/movie.mkv', playbackTime: 42 }],
  updateRecentItemPlaybackTimeByPath: mock.savePosition,
}));
import { MpvPlayer } from './MpvPlayer';

describe('mpv study panel', () => {
  it('keeps controls below video and study tools together without reopening when resized', async () => {
    vi.clearAllMocks();
    mock.embeddingAvailable.mockResolvedValue(true);
    const root = document.createElement('div'); document.body.append(root);
    const subtitles = { clearSubtitles: vi.fn(), loadLiveSubtitle: vi.fn(), tokens: () => [],
      isTokenizing: () => false, currentSubtitle: () => null } as unknown as ReturnType<typeof useSubtitles>;
    const onOpenSubtitles = vi.fn(), onToggleSidebar = vi.fn();
    const dispose = render(() => <MpvPlayer path="/tmp/movie.mkv" subtitlePath="" subtitles={subtitles}
      onState={() => {}} onOpenSubtitles={onOpenSubtitles} onToggleSidebar={onToggleSidebar} />, root);
    try {
      await vi.waitFor(() => expect(mock.open).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(root.querySelector('.mpv-playback')?.hasAttribute('disabled')).toBe(true));
      mock.callback?.({ ...INITIAL_MPV_STATE, running: true, paused: true, position: 95, duration: 1440 });
      const surface = root.querySelector('.mpv-native-surface');
      expect(surface?.nextElementSibling?.classList.contains('mpv-playback')).toBe(true);
      expect(root.querySelector('.mpv-study-column .mpv-playback')).toBeNull();
      expect(root.querySelector('.mpv-study-column .mpv-study')).not.toBeNull();
      expect(root.querySelector('.mpv-study-column .mpv-transcript-panel')).not.toBeNull();
      expect(root.querySelector<HTMLDetailsElement>('.mpv-options')?.open).toBe(false);
      const width = root.querySelector<HTMLInputElement>('.mpv-width-control input')!;
      expect(width.value).toBe('58');
      width.value = '63'; width.dispatchEvent(new Event('input', { bubbles: true }));
      expect(root.querySelector('.mpv-width-control output')?.textContent).toBe('63%');
      expect(root.querySelector<HTMLElement>('.mpv-layout')?.style.getPropertyValue('--mpv-video-width')).toBe('63%');
      expect(root.querySelector('.mpv-native-surface')).toBe(surface);
      await Promise.resolve();
      expect(mock.open).toHaveBeenCalledOnce();
      const buttons = root.querySelectorAll<HTMLButtonElement>('.mpv-transport button');
      buttons[0].click(); buttons[1].click(); buttons[2].click(); buttons[3].click();
      expect(mock.control).toHaveBeenCalledWith({ action: 'pause', value: false });
      expect(mock.control).toHaveBeenCalledWith({ action: 'fullscreen' });
      expect(onOpenSubtitles).toHaveBeenCalledOnce(); expect(onToggleSidebar).toHaveBeenCalledOnce();
      const seek = root.querySelector<HTMLInputElement>('.mpv-position input')!;
      expect(seek.getAttribute('aria-valuetext')).toBe('1:35 / 24:00');
      seek.value = '110'; seek.dispatchEvent(new Event('change', { bubbles: true }));
      expect(mock.control).toHaveBeenCalledWith({ action: 'seek', value: 110 });
    } finally { dispose(); root.remove(); mock.embeddingAvailable.mockResolvedValue(false); }
  });
  it('starts opt-in embedded mode and switches back to a separate window at the current position', async () => {
    mock.embeddingAvailable.mockResolvedValue(true);
    const root = document.createElement('div'); document.body.append(root);
    const subtitles = { clearSubtitles: vi.fn(), loadLiveSubtitle: vi.fn(), tokens: () => [],
      isTokenizing: () => false, currentSubtitle: () => null } as unknown as ReturnType<typeof useSubtitles>;
    const dispose = render(() => <MpvPlayer path="/tmp/movie.mkv" subtitlePath="/tmp/subs.ass" subtitles={subtitles}
      onState={() => {}} onOpenSubtitles={() => {}} onToggleSidebar={() => {}} />, root);
    try {
      await vi.waitFor(() => expect(mock.open).toHaveBeenCalledWith('/tmp/movie.mkv', 42,
        expect.objectContaining({ viewportWidth: window.innerWidth })));
      expect(root.querySelector('.mpv-native-surface')).not.toBeNull();
      expect(root.querySelector('[data-contained-hover="true"]')).not.toBeNull();
      await vi.waitFor(() => expect(mock.setViewport).toHaveBeenCalled());
      mock.callback?.({ ...INITIAL_MPV_STATE, running: true, position: 95 });
      const toggle = root.querySelector('.mpv-embed-toggle input') as HTMLInputElement;
      toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => expect(mock.open).toHaveBeenLastCalledWith('/tmp/movie.mkv', 95));
      expect(root.querySelector('.mpv-native-surface')).toBeNull();
      expect(root.querySelector('[data-contained-hover="false"]')).not.toBeNull();
      await vi.waitFor(() => expect(mock.addSubtitle).toHaveBeenCalledWith('/tmp/subs.ass'));
    } finally { dispose(); root.remove(); mock.embeddingAvailable.mockResolvedValue(false); }
  });
  it('resumes, loads external subtitles, selects real track IDs and cleans up', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const subtitles = {
      clearSubtitles: vi.fn(), loadLiveSubtitle: vi.fn(), tokens: () => [],
      isTokenizing: () => false, currentSubtitle: () => null,
    } as unknown as ReturnType<typeof useSubtitles>;
    const onState = vi.fn();
    const onStudyReset = vi.fn();
    const dispose = render(() => <MpvPlayer path="/tmp/movie.mkv" subtitlePath="/tmp/subs.ass"
      subtitles={subtitles} onState={onState} onStudyReset={onStudyReset} onOpenSubtitles={() => {}} onToggleSidebar={() => {}} />, root);
    try {
      await vi.waitFor(() => expect(mock.open).toHaveBeenCalledWith('/tmp/movie.mkv', 42));
      await vi.waitFor(() => expect(mock.addSubtitle).toHaveBeenCalledWith('/tmp/subs.ass'));
      const state: MpvState = { ...INITIAL_MPV_STATE, running: true, position: 173, subtitleText: 'sentence',
        subtitleStart: 88.2, subtitleEnd: 89.95, subtitleDelay: 84.8,
        tracks: [{ id: 4, type: 'audio', selected: true, title: 'Original' }, { id: 7, type: 'sub', selected: true }] };
      mock.callback?.(state);
      expect(subtitles.loadLiveSubtitle).toHaveBeenLastCalledWith({ text: 'sentence', start: 173, end: 174.75 });
      const count = vi.mocked(subtitles.loadLiveSubtitle).mock.calls.length;
      const resets = onStudyReset.mock.calls.length;
      mock.callback?.({ ...state, position: 173.1 });
      expect(subtitles.loadLiveSubtitle).toHaveBeenCalledTimes(count);
      expect(onStudyReset).toHaveBeenCalledTimes(resets);
      mock.callback?.({ ...state, subtitleDelay: 85 });
      expect(onStudyReset).toHaveBeenCalledTimes(resets + 1);
      const selects = root.querySelectorAll('select');
      expect(selects[0].value).toBe('4');
      selects[0].value = '';
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      expect(mock.control).toHaveBeenCalledWith({ action: 'audioTrack', value: null });
      expect(await getNativeVideoCapture()?.()).toContain('base64,frame');
      expect(await getNativeVideoCapture()?.(173.5)).toContain('base64,selected');
      expect(mock.screenshotAt).toHaveBeenCalledWith(173.5);
      expect(onState).toHaveBeenCalled();
    } finally { dispose(); root.remove(); }
    expect(mock.close).toHaveBeenCalled();
    expect(mock.unsubscribe).toHaveBeenCalled();
    expect(getNativeVideoCapture()).toBeNull();
  });
  it('loads a transcript, pauses/seeks with delay, and looks up a word through the bridge', async () => {
    vi.clearAllMocks();
    const root = document.createElement('div'); document.body.append(root);
    const subtitles = { clearSubtitles: vi.fn(), loadLiveSubtitle: vi.fn(), tokens: () => [],
      isTokenizing: () => false, currentSubtitle: () => null } as unknown as ReturnType<typeof useSubtitles>;
    const dispose = render(() => <MpvPlayer path="/tmp/movie.mkv" subtitlePath="" subtitles={subtitles}
      onState={() => {}} onOpenSubtitles={() => {}} onToggleSidebar={() => {}} />, root);
    try {
      await vi.waitFor(() => expect(mock.open).toHaveBeenCalled());
      mock.callback?.({ ...INITIAL_MPV_STATE, running: true, paused: true, position: 173,
        subtitleDelay: 84.8, tracks: [{ id: 7, type: 'sub', selected: true }] });
      await vi.waitFor(() => expect(root.querySelectorAll('.mpv-transcript-row')).toHaveLength(2));
      expect(root.querySelector('details')?.open).toBe(false);
      const row = root.querySelector('.mpv-transcript-row') as HTMLButtonElement;
      expect(row.getAttribute('aria-current')).toBe('true');
      row.click();
      await vi.waitFor(() => expect(mock.control).toHaveBeenCalledWith({ action: 'seek', value: 173 }));
      expect(mock.control).toHaveBeenCalledWith({ action: 'pause', value: true });
      await vi.waitFor(() => expect(subtitles.loadLiveSubtitle).toHaveBeenLastCalledWith({ text: 'selected sentence', start: 173, end: 174.75 }));
      const input = root.querySelector('.mpv-lookup input') as HTMLInputElement;
      input.value = '食べる'; input.dispatchEvent(new Event('input', { bubbles: true }));
      root.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(mock.lookupDictionary).toHaveBeenCalledWith('食べる'));
    } finally { dispose(); root.remove(); }
  });
  it('rejects stale transcript results after the track is switched off', async () => {
    let finish!: (value: { trackId: number | null; content: string }) => void;
    mock.transcript.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const root = document.createElement('div'); document.body.append(root);
    const subtitles = { clearSubtitles: vi.fn(), loadLiveSubtitle: vi.fn(), tokens: () => [],
      isTokenizing: () => false, currentSubtitle: () => null } as unknown as ReturnType<typeof useSubtitles>;
    const dispose = render(() => <MpvPlayer path="/tmp/movie.mkv" subtitlePath="" subtitles={subtitles}
      onState={() => {}} onOpenSubtitles={() => {}} onToggleSidebar={() => {}} />, root);
    try {
      await vi.waitFor(() => expect(root.querySelector('fieldset')?.disabled).toBe(true));
      await Promise.resolve(); await Promise.resolve();
      mock.callback?.({ ...INITIAL_MPV_STATE, running: true, tracks: [{ id: 7, type: 'sub', selected: true }] });
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      mock.callback?.({ ...INITIAL_MPV_STATE, running: true, tracks: [] });
      finish({ trackId: 7, content: '1\n00:00:01,000 --> 00:00:03,000\nstale' });
      await Promise.resolve(); await Promise.resolve();
      expect(root.querySelectorAll('.mpv-transcript-row')).toHaveLength(0);
    } finally { dispose(); root.remove(); }
  });
});
