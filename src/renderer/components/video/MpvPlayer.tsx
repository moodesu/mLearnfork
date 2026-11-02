import { createEffect, createMemo, createSignal, onCleanup, onMount, untrack, For, Show, type Component } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import { INITIAL_MPV_STATE, type MpvControl, type MpvState, type MpvTrack } from '../../../shared/mpv';
import type { Subtitle, Token } from '../../../shared/types';
import { useLocalization, useLanguage } from '../../context';
import type { useSubtitles } from '../../hooks/useSubtitles';
import { SubtitleContainer } from '../subtitle/SubtitleContainer';
import { registerNativeVideoCapture } from '../../services/nativeVideoCapture';
import { getRecentItems, updateRecentItemPlaybackTimeByPath } from '../../services/thumbnailService';
import { activeTranscriptIndex, delayedCue, parseMpvTranscript, transcriptTime } from '../../utils/mpvTranscript';
import { getTokenLookupWord } from '../../utils/wordForms';
import { measureMpvViewport, observeMpvViewport } from '../../services/mpvViewport';
import './MpvPlayer.css';

interface Props {
  path: string;
  subtitlePath: string;
  subtitles: ReturnType<typeof useSubtitles>;
  onState: (state: MpvState) => void;
  onOpenSubtitles: () => void;
  onToggleSidebar: () => void;
  onStudyReset?: () => void;
}

export const MpvPlayer: Component<Props> = props => {
  const { t } = useLocalization();
  const { getLanguageFeatures } = useLanguage();
  const bridge = getBridge().mpv;
  const [state, setState] = createSignal<MpvState>({ ...INITIAL_MPV_STATE, tracks: [] });
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const [embeddingAvailable, setEmbeddingAvailable] = createSignal<boolean | null>(null);
  const [embedded, setEmbedded] = createSignal(false);
  const [videoWidth, setVideoWidth] = createSignal(58);
  let videoArea: HTMLDivElement | undefined;
  const [transcript, setTranscript] = createSignal<Subtitle[]>([]);
  const [transcriptError, setTranscriptError] = createSignal('');
  const [loadingTranscript, setLoadingTranscript] = createSignal(false);
  const [selectedCue, setSelectedCue] = createSignal<Subtitle | null>(null);
  const [follow, setFollow] = createSignal(true);
  const [lookupWord, setLookupWord] = createSignal('');
  const [lookingUp, setLookingUp] = createSignal(false);
  let transcriptGeneration = 0;
  let selectionGeneration = 0;
  let transcriptList: HTMLDivElement | undefined;
  const rows = new Map<number, HTMLButtonElement>();
  let generation = 0;
  let disposed = false;
  let loadedPath = '';
  let lastSavedPosition = 0;
  const fail = (reason: unknown) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); };
  const command = async (control: MpvControl) => {
    try { await bridge.control(control); } catch (reason) { fail(reason); }
  };
  const savePosition = () => {
    if (loadedPath && state().position > 0) void updateRecentItemPlaybackTimeByPath(loadedPath, state().position).catch(fail);
  };
  const open = async (filePath: string) => {
    const current = ++generation;
    const resumePosition = loadedPath === filePath ? (state().running ? state().position : lastSavedPosition) : undefined;
    savePosition();
    setReady(false);
    setState({ ...INITIAL_MPV_STATE, tracks: [] });
    setBusy(true);
    setError('');
    setTranscript([]);
    setSelectedCue(null);
    setLookupWord('');
    props.subtitles.clearSubtitles();
    try {
      const recent = (await getRecentItems()).find(item => item.path === filePath);
      if (disposed || current !== generation) return;
      loadedPath = filePath;
      lastSavedPosition = resumePosition ?? recent?.playbackTime ?? 0;
      if (embedded()) {
        if (!videoArea) throw new Error(t('mlearn.Mpv.VideoAreaUnavailable'));
        await bridge.open(filePath, lastSavedPosition, measureMpvViewport(videoArea));
      } else await bridge.open(filePath, lastSavedPosition);
      if (disposed || current !== generation) return;
      setReady(true);
    } catch (reason) { if (current === generation) fail(reason); }
    finally { if (!disposed && current === generation) setBusy(false); }
  };

  onMount(() => {
    void bridge.embeddingAvailable().then(available => {
      if (disposed) return;
      setEmbedded(available);
      setEmbeddingAvailable(available);
    }).catch(reason => { fail(reason); setEmbeddingAvailable(false); });
    const unsubscribe = bridge.onState(next => {
      setState(next);
      props.onState(next);
      if (next.error) setError(next.error);
      if (Math.abs(next.position - lastSavedPosition) >= 10 || next.paused) {
        if (next.position !== lastSavedPosition) { lastSavedPosition = next.position; savePosition(); }
      }
    });
    const releaseCapture = registerNativeVideoCapture(async time => {
      try { return time === undefined ? await bridge.screenshot() : await bridge.screenshotAt(time); }
      catch (reason) { fail(reason); throw reason; }
    });
    onCleanup(() => { unsubscribe(); releaseCapture(); });
  });

  createEffect(() => {
    const filePath = props.path;
    embedded();
    if (filePath && embeddingAvailable() !== null) untrack(() => { void open(filePath); });
  });
  createEffect(() => {
    if (!embedded() || !ready() || !videoArea) return;
    onCleanup(observeMpvViewport(videoArea, viewport => {
      void bridge.setViewport(viewport).catch(fail);
    }));
  });
  createEffect(() => {
    const isReady = ready();
    const subtitlePath = props.subtitlePath;
    if (isReady && subtitlePath) void bridge.addSubtitle(subtitlePath).catch(fail);
  });
  const selectedTrack = createMemo(() => state().tracks.find(track => track.type === 'sub' && track.selected));
  const trackKey = createMemo(() => JSON.stringify([ready(), props.path, selectedTrack()?.id, selectedTrack()?.['external-filename']]));
  const loadTranscript = async () => {
    const current = ++transcriptGeneration;
    setTranscript([]);
    rows.clear();
    setTranscriptError('');
    setLoadingTranscript(ready() && !!selectedTrack());
    if (!ready() || !selectedTrack()) return;
    try {
      const result = await bridge.transcript();
      if (disposed || current !== transcriptGeneration || result.trackId !== selectedTrack()?.id) return;
      setTranscript(parseMpvTranscript(result.content));
    } catch (reason) {
      if (!disposed && current === transcriptGeneration) setTranscriptError(String(reason));
    } finally {
      if (!disposed && current === transcriptGeneration) setLoadingTranscript(false);
    }
  };
  createEffect(() => {
    trackKey();
    untrack(() => { selectionGeneration++; setSelectedCue(null); setLookupWord(''); props.onStudyReset?.(); void loadTranscript(); });
  });
  const subtitleDelay = createMemo(() => state().subtitleDelay);
  createEffect(() => {
    subtitleDelay();
    untrack(() => props.onStudyReset?.());
  });
  createEffect(() => {
    if (!state().paused) { setSelectedCue(null); }
  });
  const activeIndex = createMemo(() => activeTranscriptIndex(transcript(), state().position, state().subtitleDelay));
  createEffect(() => {
    const index = activeIndex();
    if (!follow() || index < 0) return;
    // Solid inserts the new list rows after the transcript signal changes.
    queueMicrotask(() => {
      const row = rows.get(index);
      if (!disposed && follow() && row && transcriptList) {
        transcriptList.scrollTop = Math.max(0, row.offsetTop - transcriptList.clientHeight / 2);
      }
    });
  });
  const selectCue = async (subtitle: Subtitle) => {
    const selection = ++selectionGeneration;
    try {
      await bridge.control({ action: 'pause', value: true });
      if (disposed || selection !== selectionGeneration) return;
      await bridge.control({ action: 'seek', value: Math.max(0, subtitle.start + state().subtitleDelay) });
      if (disposed || selection !== selectionGeneration) return;
      setSelectedCue(subtitle);
      setLookupWord('');
      setFollow(false);
    } catch (reason) { fail(reason); }
  };
  const lookup = async (word: string) => {
    if (!word.trim() || lookingUp()) return;
    setLookingUp(true); setError('');
    try { await bridge.control({ action: 'pause', value: true }); await bridge.lookupDictionary(word); }
    catch (reason) { fail(reason); }
    finally { if (!disposed) setLookingUp(false); }
  };
  const selectWord = (token: Token) => {
    const word = getTokenLookupWord(token, getLanguageFeatures().tokenizerCapabilities);
    setLookupWord(word);
    void lookup(word);
  };
  // time-pos events must not retrigger tokenization of an unchanged cue.
  const cue = createMemo(() => JSON.stringify([
    state().subtitleText, state().subtitleStart, state().subtitleEnd, state().subtitleDelay, selectedCue(),
  ]));
  createEffect(() => {
    cue();
    const next = untrack(state);
    const selected = untrack(selectedCue);
    untrack(() => props.subtitles.loadLiveSubtitle(selected ? delayedCue(selected, next.subtitleDelay) : next.subtitleText ? {
      text: next.subtitleText,
      start: next.subtitleStart + next.subtitleDelay,
      end: next.subtitleEnd + next.subtitleDelay,
    } : null));
  });
  onCleanup(() => {
    savePosition();
    disposed = true;
    generation++;
    transcriptGeneration++;
    selectionGeneration++;
    void bridge.close().catch(() => {});
    props.subtitles.clearSubtitles();
  });
  const label = (track: MpvTrack) => `${track.id}: ${track.title || track.lang || track.type}${track.title && track.lang ? ` (${track.lang})` : ''}`;
  const selected = (type: string) => String(state().tracks.find(track => track.type === type && track.selected)?.id ?? '');
  const timeLabel = () => `${transcriptTime(state().position)} / ${transcriptTime(state().duration)}`;

  return <section class="mpv-player" classList={{ 'mpv-embedded': embedded() }}>
    <div class="mpv-layout-tools">
    <Show when={embeddingAvailable()}>
      <label class="mpv-embed-toggle"><input type="checkbox" checked={embedded()} disabled={busy()}
        onChange={event => setEmbedded(event.currentTarget.checked)} />{t('mlearn.Mpv.Embedded')}</label>
    </Show>
    <Show when={embedded()}>
      <label class="mpv-width-control">{t('mlearn.Mpv.VideoWidth')}
        <input type="range" min="35" max="65" step="1" value={videoWidth()}
          onInput={event => setVideoWidth(Number(event.currentTarget.value))} />
        <output>{videoWidth()}%</output>
      </label>
    </Show>
    </div>
    <Show when={error()}><p role="alert" class="mpv-error">{error()}</p></Show>
    <Show when={!state().running && !busy()}>
      <button onClick={() => void open(props.path)}>{t('mlearn.Mpv.Retry')}</button>
    </Show>
    <div class="mpv-layout" style={{ '--mpv-video-width': `${videoWidth()}%` }}>
      <div class="mpv-video-column">
    <Show when={embedded()}>
        <div ref={videoArea} class="mpv-native-surface" aria-label={t('mlearn.Mpv.Embedded')} />
    </Show>
    <fieldset class="mpv-playback" disabled={!ready() || !state().running || busy()}>
      <div class="mpv-controls mpv-transport">
        <button class="mpv-play-button" onClick={() => void command({ action: 'pause', value: !state().paused })}>
          {t(state().paused ? 'mlearn.Mpv.Play' : 'mlearn.Mpv.Pause')}
        </button>
        <button onClick={() => void command({ action: 'fullscreen' })}>{t(embedded() ? 'mlearn.Mpv.FullscreenApp' : 'mlearn.Mpv.Fullscreen')}</button>
        <button onClick={props.onOpenSubtitles}>{t('mlearn.Video.UI.OpenSubtitles')}</button>
        <button onClick={props.onToggleSidebar}>{t('mlearn.Mpv.Words')}</button>
        <output class="mpv-time">{timeLabel()}</output>
      </div>
      <label class="mpv-position"><span>{t('mlearn.Mpv.Position')}</span>
        <input type="range" aria-valuetext={timeLabel()} min="0" max={state().duration || 1} step="0.1" value={state().position}
          onChange={event => void command({ action: 'seek', value: Number(event.currentTarget.value) })} />
      </label>
      <details class="mpv-options">
        <summary>{t('mlearn.Mpv.Options')}</summary>
      <div class="mpv-controls">
        <For each={['audio', 'sub'] as const}>{type => <label>
          {t(type === 'audio' ? 'mlearn.Mpv.AudioTrack' : 'mlearn.Mpv.SubtitleTrack')}
          <select value={selected(type)} onChange={event => void command({
            action: type === 'audio' ? 'audioTrack' : 'subtitleTrack',
            value: event.currentTarget.value ? Number(event.currentTarget.value) : null,
          })}>
            <option value="">{t('mlearn.Mpv.Off')}</option>
            <For each={state().tracks.filter(track => track.type === type)}>{track => <option value={String(track.id)}>{label(track)}</option>}</For>
          </select>
        </label>}</For>
        <label>{t('mlearn.Mpv.Delay')}
          <input type="number" step="0.1" min="-3600" max="3600" value={state().subtitleDelay}
            onChange={event => void command({ action: 'subtitleDelay', value: Number(event.currentTarget.value) })} />
        </label>
        <label>{t('mlearn.Mpv.Volume')}
          <input type="range" min="0" max="100" value={state().volume}
            onChange={event => void command({ action: 'volume', value: Number(event.currentTarget.value) })} />
        </label>
        <label>{t('mlearn.Mpv.Speed')}
          <input type="number" step="0.05" min="0.25" max="4" value={state().speed}
            onChange={event => void command({ action: 'speed', value: Number(event.currentTarget.value) })} />
        </label>
      </div>
      </details>
    </fieldset>
    </div>
    <div class="mpv-study-column">
    <div class="mpv-study">
      <div class="mpv-controls mpv-sentence-heading">
        <strong>{t(selectedCue() ? 'mlearn.Mpv.SelectedLine' : 'mlearn.Mpv.CurrentLine')}</strong>
        <Show when={selectedCue()}><button onClick={() => { setSelectedCue(null); setFollow(true); }}>
          {t('mlearn.Mpv.Follow')}
        </button></Show>
      </div>
      <div class="mpv-subtitles">
      <SubtitleContainer tokens={props.subtitles.tokens()} isLoading={props.subtitles.isTokenizing()}
        originalText={props.subtitles.currentSubtitle()?.text}
        subtitleStart={props.subtitles.currentSubtitle()?.start} subtitleEnd={props.subtitles.currentSubtitle()?.end}
        nativeSource={props.path} containedHover={embedded()} onWordClick={selectWord} />
      </div>
      <form class="mpv-lookup" onSubmit={event => { event.preventDefault(); void lookup(lookupWord()); }}>
        <input aria-label={t('mlearn.Mpv.LookupWord')} value={lookupWord()} maxLength={256}
          placeholder={t('mlearn.Mpv.LookupWord')} onInput={event => setLookupWord(event.currentTarget.value)} />
        <button type="submit" disabled={!lookupWord().trim() || lookingUp()}>{t('mlearn.Mpv.GoldenDict')}</button>
      </form>
      <p class="mpv-hint">{t('mlearn.Mpv.LookupHint')}</p>
    </div>
    <div class="mpv-transcript-panel">
    <div class="mpv-controls mpv-transcript-heading">
      <strong>{t('mlearn.Mpv.Transcript')} <span class="mpv-cue-count">{transcript().length}</span></strong>
      <label class="mpv-follow"><input type="checkbox" checked={follow()} onChange={event => setFollow(event.currentTarget.checked)} />{t('mlearn.Mpv.Follow')}</label>
      <button disabled={loadingTranscript() || !ready()} onClick={() => void loadTranscript()}>{t('mlearn.Mpv.Reload')}</button>
    </div>
    <Show when={loadingTranscript()}><p role="status">{t('mlearn.Mpv.LoadingTranscript')}</p></Show>
    <Show when={transcriptError()}><p role="alert" class="mpv-error">{transcriptError()}</p></Show>
    <Show when={!loadingTranscript() && !transcript().length && !transcriptError()}><p>{t('mlearn.Mpv.NoTranscript')}</p></Show>
    <div ref={transcriptList} class="mpv-transcript" role="region" aria-label={t('mlearn.Mpv.Transcript')}
      onWheel={() => setFollow(false)}>
      <For each={transcript()}>{(subtitle, index) => <button ref={element => rows.set(index(), element)}
        class="mpv-transcript-row" classList={{ active: activeIndex() === index(), selected: selectedCue() === subtitle }}
        aria-current={activeIndex() === index() ? 'true' : undefined}
        onClick={() => void selectCue(subtitle)}>
        <time>{transcriptTime(subtitle.start + state().subtitleDelay)}</time><span>{subtitle.text}</span>
      </button>}</For>
    </div>
    </div>
    </div>
    </div>
  </section>;
};
