/**
 * Unruh - Debug capture
 *
 * Streams per-beat detector state out of the running app so the *actual* data
 * can be inspected after the fact instead of screenshotting the UI.
 *
 * Why this exists: every number on screen is a median or a rolling window, so
 * a screenshot cannot answer "was this beat timed on the unlock or on the
 * banking burst?". Capturing the per-beat record plus a small decimated
 * envelope makes that checkable — the envelope is what shows whether the pick
 * sat on the faint unlock blip or on the loud burst 10-30 ms later.
 *
 * Cost model: this is fed from App's `onBeat` handler, which already runs
 * outside the ScriptProcessor callback, so it can never delay audio analysis.
 * Records are plain numbers; the envelope is decimated to ~1 kHz once per
 * beat (a single O(n) pass over the existing 70 ms snippet).
 *
 * Transport: in dev the lines are POSTed to the Vite plugin in vite.config.ts
 * (`POST /unruh/__unruh-debug`), which appends them to
 * `.unruh-debug/live.ndjson` — an agent can read that file directly. Anywhere
 * else (GitHub Pages has no endpoint) the buffer is kept in memory and can be
 * downloaded as JSONL from the debug panel.
 */

import type { BeatMeasurement } from '../types/timegrapher';

export type DebugSource = 'mic' | 'recording' | 'synth';

export interface DebugBeatContext {
  bph: number;
  noise: number;
  threshold: number;
  /** Which input produced the beat — runs are easier to compare when labelled. */
  source: DebugSource;
}

export interface DebugBeatRecord {
  v: 1;
  wall: number; // Date.now(), ms since epoch
  ts: number; // beat.timestamp = performance.now(), milliseconds
  b: number; // beat counter
  tick: boolean;
  dt: number | null; // interval since previous recorded beat, ms
  per: number; // measured period, ms
  rate: number; // s/d
  be: number; // beat error, ms
  amp: number; // amplitude, deg
  unlock: number; // display-snippet offset, ms
  banking: number; // display-snippet offset, ms
  lift: number; // unlock -> banking for this beat, ms
  bph: number;
  src: DebugSource;
  noise: number;
  thr: number;
  peak?: number; // absolute envelope peak of the snippet
  env?: number[]; // 70 ms envelope, ~1 kHz, 0..255 relative to this beat's peak
  pcm?: string; // optional full-rate snippet: base64 Int16, normalized by `peak`
}

export type DebugSinkState = 'off' | 'buffering' | 'live' | 'error';

export interface DebugCaptureConfig {
  enabled: boolean;
  envelopes: boolean;
  /** Full 48 kHz snippets, base64 Int16 (~9 KB/beat). Off by default: only
   *  needed when replaying the landmark pick at full resolution offline. */
  fullSnippets: boolean;
}

export interface DebugCaptureStats {
  config: DebugCaptureConfig;
  sink: DebugSinkState;
  lastError: string | null;
  beats: number;
  pendingLines: number;
  pendingBytes: number;
  startedAt: number | null;
  lastBeat: DebugBeatRecord | null;
  recent: DebugBeatRecord[];
  fullSnippets: number;
  maxFullSnippets: number;
}

const STORAGE_KEY = 'chronoscope_debug_capture_v1';
const ENV_TARGET_HZ = 1000;
/** ~1 h at 5 beats/s: enough for a download, small enough not to bloat memory. */
const MAX_BUFFER_LINES = 20000;
const MAX_PENDING = 50; // flush at least this often, so a crash loses little
const FLUSH_INTERVAL_MS = 1000;

const devSinkUrl = `${import.meta.env.BASE_URL}__unruh-debug`;

/**
 * Full-rate snippets are capped so a forgotten capture cannot fill the disk:
 * 500 beats is ~4.5 MB and ~100 s at 5 beats/s, which is plenty for a
 * landmark comparison. Later beats keep their scalars and 1 kHz envelope.
 */
const MAX_FULL_SNIPPETS = 500;

const DEFAULT_CONFIG: DebugCaptureConfig = {
  enabled: false,
  envelopes: true,
  fullSnippets: false,
};

let config: DebugCaptureConfig = loadConfig();
let sink: DebugSinkState = 'off';
let lastError: string | null = null;
let lines: string[] = [];
let beats = 0;
let fullSnippets = 0;
let startedAt: number | null = null;
let lastAudioTs: number | null = null;
let lastBeat: DebugBeatRecord | null = null;
let recent: DebugBeatRecord[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
// Shared so callers (Clear) can wait for an in-flight POST instead of racing it.
let flushPromise: Promise<void> | null = null;

function loadConfig(): DebugCaptureConfig {
  // Persisted so a reload keeps capturing; the toggle is explicit and the sink
  // is dev-only, so there is no surprise network traffic in production.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<DebugCaptureConfig>;
    return {
      enabled: parsed.enabled === true,
      envelopes: parsed.envelopes !== false,
      fullSnippets: parsed.fullSnippets === true,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private mode / quota: capture still works for this session */
  }
}

/**
 * Max-abs decimation to ~1 kHz, normalised to this beat's own peak.
 *
 * Relative normalisation keeps the burst structure comparable from beat to
 * beat even as mic gain or contact pressure drifts; the absolute `peak` is
 * stored alongside so gain changes stay visible.
 */
function decimateEnvelope(snippet: Float32Array, sampleRate: number): { env: number[]; peak: number } {
  const block = Math.max(1, Math.round(sampleRate / ENV_TARGET_HZ));
  const count = Math.ceil(snippet.length / block);
  const env = new Array<number>(count);
  let peak = 0;

  for (let b = 0; b < count; b++) {
    const start = b * block;
    const end = Math.min(snippet.length, start + block);
    let m = 0;
    for (let i = start; i < end; i++) {
      const v = snippet[i] < 0 ? -snippet[i] : snippet[i];
      if (v > m) m = v;
    }
    if (m > peak) peak = m;
    env[b] = m;
  }

  const scale = peak > 0 ? 255 / peak : 0;
  for (let i = 0; i < count; i++) env[i] = Math.round(env[i] * scale);
  return { env, peak: +peak.toFixed(4) };
}

/**
 * Encode the 70 ms snippet as base64 Int16, normalised to its own peak.
 *
 * Float JSON would be ~23 KB/beat and lossy-looking; Int16 base64 is ~9 KB and
 * exactly reproducible once multiplied back by `peak` (stored alongside), so
 * the offline replay sees the same waveform the detector did.
 */
function encodeSnippetPcm(snippet: Float32Array): string {
  let peak = 0;
  for (let i = 0; i < snippet.length; i++) {
    const v = snippet[i] < 0 ? -snippet[i] : snippet[i];
    if (v > peak) peak = v;
  }
  const scale = peak > 0 ? 32767 / peak : 0;
  const bytes = new Uint8Array(snippet.length * 2);
  for (let i = 0; i < snippet.length; i++) {
    let v = Math.round(snippet[i] * scale);
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    bytes[i * 2] = v & 0xff;
    bytes[i * 2 + 1] = (v >> 8) & 0xff;
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function trimBuffer(): void {
  if (lines.length > MAX_BUFFER_LINES) {
    lines = lines.slice(lines.length - MAX_BUFFER_LINES);
  }
}

export function getDebugCaptureConfig(): DebugCaptureConfig {
  return { ...config };
}

export function setDebugCaptureEnabled(enabled: boolean): void {
  config.enabled = enabled;
  saveConfig();
  if (enabled) {
    startedAt = startedAt ?? Date.now();
    lastAudioTs = null; // first beat of a new capture has no interval
    if (flushTimer === null) {
      flushTimer = setInterval(() => {
        void flush();
      }, FLUSH_INTERVAL_MS);
    }
  } else {
    if (flushTimer !== null) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    void flush(); // ship what is already buffered
    startedAt = null;
  }
}

export function setDebugEnvelopesEnabled(enabled: boolean): void {
  config.envelopes = enabled;
  saveConfig();
}

export function setDebugFullSnippetsEnabled(enabled: boolean): void {
  config.fullSnippets = enabled;
  saveConfig();
}

export function isDebugCaptureEnabled(): boolean {
  return config.enabled;
}

export function recordDebugBeat(beat: BeatMeasurement, ctx: DebugBeatContext): void {
  if (!config.enabled) return;

  const ts = Number.isFinite(beat.timestamp) ? beat.timestamp : 0;
  // beat.timestamp is performance.now() in ms (set in
  // handleDetectedBeatFromRing), i.e. the same clock the detector times beats
  // with. A detector reset shows up as a non-physical jump, which we drop
  // rather than log as an interval.
  let dt: number | null = null;
  if (lastAudioTs !== null && ts > lastAudioTs) {
    const candidate = ts - lastAudioTs;
    if (candidate > 1 && candidate < 5000) dt = +candidate.toFixed(3);
  }
  lastAudioTs = ts > 0 ? ts : lastAudioTs;

  const record: DebugBeatRecord = {
    v: 1,
    wall: Date.now(),
    ts: +ts.toFixed(4),
    b: beat.id,
    tick: beat.isTick,
    dt,
    per: +beat.measuredPeriodMs.toFixed(2),
    rate: +beat.rateErrorSecondsPerDay.toFixed(1),
    be: +beat.beatErrorMs.toFixed(2),
    amp: beat.amplitudeDeg,
    unlock: +beat.unlockMs.toFixed(2),
    banking: +beat.bankingMs.toFixed(2),
    lift: +beat.liftTimeMs.toFixed(2),
    bph: ctx.bph,
    src: ctx.source,
    noise: +ctx.noise.toFixed(5),
    thr: +ctx.threshold.toFixed(5),
  };

  if (beat.waveformSnippet && beat.waveformSnippet.length > 0) {
    if (config.fullSnippets && fullSnippets < MAX_FULL_SNIPPETS) {
      record.pcm = encodeSnippetPcm(beat.waveformSnippet);
      fullSnippets += 1;
    }
    if (config.envelopes || record.pcm) {
      const { env, peak } = decimateEnvelope(
        beat.waveformSnippet,
        beat.snippetSampleRate ?? 48000
      );
      record.peak = peak;
      if (config.envelopes) record.env = env;
    }
  }

  lines.push(JSON.stringify(record));
  beats += 1;
  lastBeat = record;
  recent = recent.length >= 120 ? recent.slice(recent.length - 119).concat(record) : recent.concat(record);
  trimBuffer();

  if (lines.length >= MAX_PENDING) void flush();
}

function flush(): Promise<void> {
  // Awaiting an in-flight flush is what makes Stop -> Clear deterministic:
  // without it the reset POST could rotate the file before the last batch
  // lands, splitting a run across two files.
  if (flushPromise) return flushPromise;
  if (lines.length === 0) return Promise.resolve();
  if (!import.meta.env.DEV) {
    sink = config.enabled ? 'buffering' : sink;
    return Promise.resolve();
  }

  const batch = lines;
  lines = [];
  flushPromise = (async () => {
    try {
      const res = await fetch(devSinkUrl, {
        method: 'POST',
        body: batch.join('\n') + '\n',
        keepalive: true,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sink = config.enabled ? 'live' : 'off';
      lastError = null;
    } catch (err) {
      // Keep the lines: the panel can still download them, which is the whole
      // point when the dev server is not running.
      lines = batch.concat(lines);
      trimBuffer();
      sink = config.enabled ? 'buffering' : 'off';
      lastError = err instanceof Error ? err.message : String(err);
    }
  })().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

export function getDebugCaptureStats(): DebugCaptureStats {
  const pendingBytes = lines.reduce((acc, line) => acc + line.length + 1, 0);
  return {
    config: { ...config },
    fullSnippets,
    maxFullSnippets: MAX_FULL_SNIPPETS,
    sink: config.enabled ? sink : 'off',
    lastError,
    beats,
    pendingLines: lines.length,
    pendingBytes,
    startedAt,
    lastBeat,
    recent,
  };
}

/** Last `maxLines` records as JSONL — bounded so the clipboard stays usable. */
export function getDebugJsonl(maxLines = 2000): string {
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n') + (lines.length ? '\n' : '');
}

export function downloadDebugLog(): void {
  const jsonl = getDebugJsonl(MAX_BUFFER_LINES);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `unruh-debug-${stamp}.ndjson`;
  a.click();
  // Revoke on the next tick so the click has taken the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function clearDebugCapture(): Promise<void> {
  // Ship everything first, then rotate — so the run that was just stopped is
  // complete in the rotated file and the next run starts from an empty one.
  await flush();
  if (import.meta.env.DEV) {
    try {
      await fetch(`${devSinkUrl}/reset`, { method: 'POST' });
    } catch {
      /* sink unavailable: the in-memory buffer is still cleared below */
    }
  }
  lines = [];
  beats = 0;
  fullSnippets = 0;
  recent = [];
  lastBeat = null;
  lastAudioTs = null;
  startedAt = config.enabled ? Date.now() : null;
  lastError = null;
}
