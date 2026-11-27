# AGENTS.md — Unruh

Browser-based mechanical watch timegrapher. React 19 + Vite 8 + TypeScript +
Tailwind 4, PWA, deployed to GitHub Pages under `/unruh/`.

The app listens to a watch through a microphone/piezo (or plays a recording)
and reports **rate (s/d)**, **beat error (ms)**, **amplitude (°)**, **BPH**, and
an acoustic watch ID. The user is learning watchmaking — explain findings in
plain language, not just numbers.

## Commands

```sh
npm install
npm run dev        # http://localhost:3000/unruh/   (port 3000, base /unruh/)
npm run build      # must pass
npm run lint       # = tsc --noEmit
```

`npm run lint` currently reports **5 pre-existing errors** (see Gotchas). Do not
add new ones; `npm run build` passes today.

Restart the dev server after changing `vite.config.ts` (recordings listing
plugin / PWA). Source edits use Vite HMR; the PWA can still serve stale files,
so hard-reload when the UI looks old and bump the SW cache if you touch
`public/sw.js`.

Test locally with **Simulate → Recording** (`public/recordings/`) or **Live
Mic**. `browse`/browser automation is disabled by the user — ask before using
it, and keep to `~/code` (never look in other home folders for recordings).

## Architecture

- `src/services/audioEngine.ts` — all DSP and detection. One `AudioEngine`
  instance; the app receives `BeatMeasurement`s through `onBeat` and updates
  `onAutoBphDetected`, `onAcousticSignature`, `onLevel`.
- `src/App.tsx` — state, measurement history, UI wiring/tabs.
- `src/components/OscilloscopeRateTrend.tsx` — rate graph (defaults to smoothed;
  stats describe the drawn series).
- `src/components/EscapementOscilloscope.tsx` — 70 ms pulse waveform, t1/t2/t3
  markers, Δt bracket.
- `src/components/MovementSimulatorPanel.tsx` — Synthesizer / Recording source.
- `src/services/recordingsLibrary.ts` — file listing + File System Access folder
  picker; `src/services/watchFingerprintEngine.ts` — profiles/matching.
- `src/types/timegrapher.ts` — shared types (`BeatMeasurement`, `WatchConfig`, …).

Signal path: mic/recording → gain → 400 Hz high-pass → analyser +
`ScriptProcessor(2048)` → 0.5 ms envelope → 5× noise-floor threshold → gated
beat detection → `BeatMeasurement`.

### Detection invariants (do not regress these)

These were arrived at from many real recordings; changing them usually
reintroduces jitter or wrong BPH.

1. **Gated detection**: after ~8 beats, predict the next beat and take the
   **loudest envelope sample inside ±0.25·T**. Do not use the old "sharpest
   local maximum / 1.6× rise" test — it picked sub-clicks and jittered.
2. **Beat time = t1 (the unlock)**, the first visible escapement impact in the
   scope, not the loudest burst. Impulse and drop are 10–35 ms apart; timing
   the loudest made beat error jump between clusters (2 / 19 / 35 ms).
3. **Rate/BPH**: robust 3-parameter grid (`t = a + b·i + c·(−1)^i`) over
   **48 beats**, with outlier rejection. A beat is only ~0.2 s, so 1 ms of
   jitter = ~430 s/d; the long window is what makes the display stable.
4. **Beat error**: median of even-vs-odd residuals over **16 beats**, referred
   to the long-window rate slope (robust to single bad beats).
5. **Amplitude**: computed from unlock→drop (`Δt`) using a **median Δt over
   ~16 beats** (the drop is buried in ringing on cheap movements). The t3
   marker and Δt text follow the beat's main burst; the amplitude uses the
   median. Δt is clamped 2.5–45 ms; amplitude 40–360°.
6. **Display snippet is anchored on t1** with 10 ms pre-roll, so the waveform
   does not jump when a different sub-click is loudest. t3/Δt are labelled
   `≈` / “Banking (est.)”.
7. **Auto-BPH** has 3-window hysteresis. On a new recording, auto mode resets
   to 21,600 so a short lockout from the previous file cannot trap it.
8. **Starting a recording** must stop the previous `AudioBufferSourceNode` and
   reset the detector/noise floor (`stopRecording` + `resetDetectionState`);
   without this two watches play at once and quieter files are never detected.
9. Lockout is scaled from BPH; intervals outside 0.5–1.5×T reset the phase.
   Do not hard-clamp beat error/rate to hide real values (beat error cap 49.9,
   rate `±3600 s/d` are sanity limits only).

The ring buffer is 19200 samples with a `+2048` lead offset in
`handleDetectedBeatFromRing`; changing it breaks the scope/timestamps.

## Product invariants (user decisions)

- Watch profiles are created **only** by explicit user action (“Name Watch”).
  Never seed or auto-create profiles; show “No watch on the bench” below
  `LOCK_IN_THRESHOLD = 68`.
- Simulator panel: Source switch Synthesizer/Recording; Preset only in
  Synthesizer mode; the recording select starts on “Select a watch…”.
- Recordings are listed from `public/recordings/` (dev-server JSON endpoint) or
  a user-picked folder. Add `.ogg`/`.wav` files there; no code change needed.
  Production (GitHub Pages) has no listing endpoint — the folder picker is the
  fallback.
- Amplitude may genuinely be low (pin-levers/Irax). Never force it to ~350°;
  low readings are real.
- Profiles live in localStorage (`chronoscope_watch_profiles_v2`); clearing
  site data deletes the user’s watches.

## Reference recordings and expected results

`public/recordings/` holds the development set. Rates below are **dial-up**
app readings and depend on winding/position — treat them as regression targets,
not absolute truth.

| Recording | BPH | Rate (s/d) | Beat error (ms) |
|---|---:|---:|---:|
| Pobeda (clean 18k reference) | 18,000 | −87 ± 4 | 2.8 |
| Certina Festival | 21,600 | +86 ± 15 | 5.1 (offline 2.4) |
| Bilat | 28,800 | −274 ± 79 | 3.7 |
| ZIM 2602 dial-up | 18,000 | +190 | 9.8 |
| Eloga | 18,000 | +68 | 3.2 |
| Rila Manual Wind | 18,000 | −20 ± 50 | 0.5–6.5 |
| Irax EB8800 (old take) | 18,000 | +235 | 20.7 |
| Irax EB8800 (new take) | 18,000 | +287 | 3.4 |
| Büren | 18,000 | −480 ± 88 | 6.7 |
| Giroxa | 28,800 | +9 ± 13 | 3.3 |
| Watex | 28,800 | −127 ± 7 | 1.7 |
| Mondaine (stress case) | 18,000 | −256 | 2.8 (varies a lot) |

The beat-error anchor reads ~1–2 ms high on a few watches (e.g. Certina,
Pobeda); for stud adjustments, compare changes on the same watch/position, not
the absolute number.

Offline cross-check (independent of the app): decode with `ffmpeg`, 400 Hz
high-pass, 0.5 ms envelope, seed on loud impacts, gate ±0.25·T, fit the grid.
This is how the table was produced.

## Synthetic fixtures

`test-fixtures/audio/` contains 20 s WAVs with a known **1.5 ms** beat error
and 18,000 bph, including mid-click traps. They are not in the app list; to
test, copy one into `public/recordings/`, reload, use Simulate → Recording,
then remove it. Regenerate with `python3 test-fixtures/audio/generate.py`.
Expected: 18,000 bph and 1.5 ms for every fixture.

## Gotchas

- Pre-existing `npm run lint` errors (keep at 5):
  `App.tsx` `classic`/`split` on the tab map, `MovementSimulatorPanel` missing
  `rateError`, `OscilloscopeRateTrend` `Type '600'`, `defaults.ts` missing
  `amplitude`.
- The app is a PWA. `index.html` registers `/unruh/sw.js` (network-first;
  bump `CACHE_NAME` when changing it) and `vite-plugin-pwa` is also configured.
  If content is stale, hard-reload and check both.
- GitHub Pages deploy: `.github/workflows/deploy.yml` (Node 20, `npm run
  build`, publish `dist`). Base path is `/unruh/`; absolute paths must include
  it.
- `public/recordings/` files are untracked in git; never delete them as
  “build artifacts”.
- No test runner. Validate DSP changes against the reference recordings and/or
  fixtures before claiming a fix.
- Real-time constraint: the ScriptProcessor callback runs at 48 kHz; keep
  per-beat work O(n), no heavy allocations in the audio path.

## Style

- TypeScript, 2-space indent, single quotes, semicolons; React function
  components; Tailwind utility classes.
- Comments should explain **why** a non-obvious choice exists (the DSP file is
  full of such decisions).
- Prefer small, measured changes; keep unrelated formatting alone.
- For any detector change, include the before/after numbers from the reference
  recordings (BPH, rate, beat error) in your summary.
