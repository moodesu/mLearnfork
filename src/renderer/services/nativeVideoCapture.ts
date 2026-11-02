type NativeCapture = (time?: number) => Promise<string | null>;
let capture: NativeCapture | null = null;

/** Scoped to the mounted native player, not a saved setting or an unrelated window. */
export function registerNativeVideoCapture(source: NativeCapture): () => void {
  capture = source;
  return () => { if (capture === source) capture = null; };
}

export function getNativeVideoCapture(): NativeCapture | null { return capture; }
