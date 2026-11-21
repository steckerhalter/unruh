/**
 * RecordingsLibrary — audio recordings of watches from the `recordings`
 * folder, to be played through the app's analysis pipeline (the same path
 * used by Live Mic) via `engine.startRecording()`.
 *
 * The folder is picked with the File System Access API ("Select recordings
 * folder"). Recordings are named after the watch, e.g. `ZIM.wav`.
 */

type FsFileEntry = {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
};

type FsDirEntry = FsFileEntry | { kind: 'directory'; name: string };

type FsDirHandle = {
  values: () => AsyncIterableIterator<FsDirEntry>;
  getFile: (name: string) => Promise<File>;
};

export const DEFAULT_RECORDINGS_FOLDER_NAME = 'recordings';

let dirHandle: FsDirHandle | null = null;
let cachedNames: string[] | null = null;

const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'm4a', 'aac', 'ogg', 'flac', 'aiff', 'aif', 'wma']);

function isAudioFile(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() || '';
  return AUDIO_EXTENSIONS.has(ext);
}

export function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export function hasRecordingsFolder(): boolean {
  return dirHandle !== null;
}

export function cachedRecordingNames(): string[] {
  return cachedNames || [];
}

/** List the watches that have a recording in the folder. */
export async function listRecordings(): Promise<string[]> {
  const names: string[] = [];
  if (dirHandle) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind !== 'file' || !isAudioFile(entry.name)) continue;
      const s = stem(entry.name);
      if (s && !names.includes(s)) names.push(s);
    }
  }
  names.sort();
  cachedNames = names;
  return names;
}

/** Pick the recordings folder (File System Access API) and list its recordings. */
export async function selectRecordingsFolder(): Promise<string[]> {
  const w = window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FsDirHandle>;
  };
  if (!w.showDirectoryPicker) {
    throw new Error('Directory picking is not supported in this browser.');
  }
  dirHandle = await w.showDirectoryPicker({ mode: 'read' });
  cachedNames = null;
  return listRecordings();
}

/**
 * Play the recording of a watch (by name) through the engine — the
 * app's analysis pipeline picks it up and the app identifies the watch.
 */
export async function playRecording(
  engine: { startRecording: (buffer: ArrayBuffer) => Promise<boolean> },
  name: string
): Promise<boolean> {
  // 1. Picked folder (File System Access).
  if (dirHandle) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind !== 'file' || !isAudioFile(entry.name)) continue;
      if (stem(entry.name) !== name && entry.name !== name) continue;
      const file = await entry.getFile();
      const buffer = await file.arrayBuffer();
      return engine.startRecording(buffer);
    }
  }
  // 2. Public recordings (dev server folder listing).
  const publicNames = await listPublicRecordings();
  const fileName = publicNames.find((n) => n === name || stem(n) === name);
  if (fileName) {
    const res = await fetch(encodeURI(`recordings/${fileName}`));
    if (res.ok) {
      const buffer = await res.arrayBuffer();
      return engine.startRecording(buffer);
    }
  }
  return false;
}

/**
 * List the recordings in the public `recordings/` folder — the dev server
 * serves the folder listing as JSON (see vite.config.ts), so the app can
 * populate its recordings list without filesystem permissions.
 */
export async function listPublicRecordings(): Promise<string[]> {
  try {
    const res = await fetch('recordings/');
    if (!res.ok) return [];
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return [];
    const names = await res.json();
    if (!Array.isArray(names)) return [];
    return names.filter((n): n is string => typeof n === 'string' && isAudioFile(n)).sort();
  } catch {
    return [];
  }
}
