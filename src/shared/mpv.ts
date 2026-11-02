/** Narrow, typed native-player API. Never expose arbitrary mpv commands to the renderer. */
export interface MpvTrack {
  id: number;
  type: 'audio' | 'sub' | 'video';
  title?: string;
  lang?: string;
  selected: boolean;
  external?: boolean;
  'external-filename'?: string;
  'ff-index'?: number;
  codec?: string;
}

export interface MpvState {
  running: boolean;
  position: number;
  duration: number;
  paused: boolean;
  volume: number;
  speed: number;
  subtitleDelay: number;
  subtitleText: string;
  subtitleStart: number;
  subtitleEnd: number;
  tracks: MpvTrack[];
  error: string | null;
}

export const INITIAL_MPV_STATE: MpvState = {
  running: false, position: 0, duration: 0, paused: true, volume: 100,
  speed: 1, subtitleDelay: 0, subtitleText: '', subtitleStart: 0,
  subtitleEnd: 0, tracks: [], error: null,
};

export type MpvControl =
  | { action: 'pause'; value: boolean }
  | { action: 'seek' | 'volume' | 'speed' | 'subtitleDelay'; value: number }
  | { action: 'audioTrack' | 'subtitleTrack'; value: number | null }
  | { action: 'fullscreen' };

export interface MpvBridge {
  open: (path: string, start: number, viewport?: MpvViewport) => Promise<void>;
  embeddingAvailable: () => Promise<boolean>;
  setViewport: (viewport: MpvViewport) => Promise<void>;
  close: () => Promise<void>;
  control: (control: MpvControl) => Promise<void>;
  addSubtitle: (path: string) => Promise<void>;
  screenshot: () => Promise<string | null>;
  screenshotAt: (time: number) => Promise<string>;
  transcript: () => Promise<{ trackId: number | null; content: string }>;
  lookupDictionary: (word: string) => Promise<void>;
  onState: (callback: (state: MpvState) => void) => () => void;
}

/** CSS coordinates in the owning renderer. Native handles never cross IPC. */
export interface MpvViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  visible: boolean;
}
