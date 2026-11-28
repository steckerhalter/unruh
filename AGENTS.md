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
- `src/components/EscapementOscilloscope.tsx` — 70 ms pulse waveform,
  Unlock/Banking markers, lift-time bracket.
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
2. **Beat time = unlock**, the first visible escapement impact in the scope,
   not the loudest burst. Impulse and drop are 10–35 ms apart; timing the
   loudest made beat error jump between clusters (2 / 19 / 35 ms).
3. **Rate/BPH**: robust 3-parameter grid (`t = a + b·i + c·(−1)^i`) over
   **48 beats**, with outlier rejection. A beat is only ~0.2 s, so 1 ms of
   jitter = ~430 s/d; the long window is what makes the display stable.
4. **Beat error**: median of even-vs-odd residuals over **16 beats**, referred
   to the long-window rate slope (robust to single bad beats).
5. **Amplitude**: computed from unlock→banking lift time using a **median lift
   time over ~16 beats** (the drop is buried in ringing on cheap movements).
   The Banking marker is the loudest peak of the main burst after the unlock
   group — not the last ring-down lobe — and the lift-time text follows it.
   The amplitude uses the median. Lift time is clamped 2.5–45 ms; amplitude
   40–360°. Picks below 3.5 ms mean the banking peak landed back on the unlock
   (a failed pick hidden by the clamp floor) and are **excluded from the median**;
   on a chamber AS 1803 they were 20 % of beats and biased the median 26→17 ms,
   i.e. the amplitude read ~15° high.
6. **Display snippet is anchored on the unlock** with 10 ms pre-roll, so the
   waveform does not jump when a different sub-click is loudest. Only Unlock
   and Banking are marked; do not reintroduce a t2/impulse marker — it is not
   used in the math and cannot be located reliably.
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

## Known limit: amplitude on ambiguous drop signatures

On the Irax EB8800 (pin-lever, ~18 ms out of beat) the unlock→banking span is
**bimodal** — modes near 18–22 ms and 32–36 ms — because the second and third
acoustic lobes are comparable in loudness (52 % of beats peak after 36 ms,
48 % before). So "loudest peak of the main burst" flips between them and the
16-beat median traverses the saddle between the two modes.

Everything below was measured with the debug capture, not estimated:

- per-beat lift ranges ~7–45 ms; the amplitude readout moves ~19–32°;
- no selection rule fixes it — last/first significant group, strongest group,
  the 16-beat median envelope and an envelope energy centroid all leave a
  14–33° swing;
- changing the landmark moves the *absolute* value (≈60° vs ≈80°) but not the
  spread: two runs on the same watch, same position, ~20 min apart differed by
  **12–15° with every estimator**, so contact/position dominates the rule.

Treat amplitude on such a movement as **±15°**, and compare runs made with the
same position/winding. Do not "stabilise" it by clamping or by redefining the
landmark: the engine's median is already the most robust choice. Verify any
future landmark change with a full-rate capture (panel → "full 48 kHz
snippets") and replay before/after. The grouping logic is exact on the
synthesizer (≤0.05 ms), but the synthesizer clamps its own lift time to
2.9–15 ms, so it cannot reproduce this case.

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

## Auto-matching the filter to the input (experimental, off by default)

`AudioSettings.autoFilter` makes the engine sweep the pallet filter once per
input start (`startAutoCalibration()`): six 1.2 s steps 3/5/7/9/12/16 kHz, count
detected beats in each, keep the best, and reset the detection state. Detection
itself is the objective, so there is no circular dependency on the current
filter. The chosen band and its beat rate are shown in the Audio Settings modal
(`onSensorProfile`).

Measured with the headless harness (fake microphone fed the recordings):

| input | auto-selected band | beats/s | BPH lock |
|---|---|---:|---|
| contact mic (28,800) | 12,000 Hz | 7.98 | 28,800 |
| chamber: Giroxa | 5,000 Hz | 8.00 | 28,800 |
| chamber: Watex | 7,000 Hz | 7.98 | 28,800 |
| chamber: Pobeda | 7,000 Hz | 5.00 | 18,000 |
| chamber: Certina | 12,000 Hz | 6.00 | 21,600 |
| chamber: ZIM (noisy) | 5,000 Hz | 4.74 | 18,000 |

Trade-off recorded: because the amplitude/lift path uses the filtered snippet,
the chosen band shifts the readings slightly — Pobeda went from −92 s/d (bench at
4.5 kHz) to −108 s/d with autoFilter, Certina +83 → +100. Hence the setting is
**off by default**; it is the recommended switch for a new or unknown sensor, not
a replacement for the measured defaults.

Limits: it cannot help clicks below the 2 kHz band-pass minimum, and a signal
that detects zero beats in every step falls back to the current band.

## Matching the pallet filter to the sensor

The detector only works when the pallet band-pass sits on the click energy. This
was measured on 2 Dec 2026 by sweeping `bandPassFreq` through the running app
(headless harness) and counting detected beats:

| recording | click band | detections at 4.5 kHz | at 10–14 kHz |
|---|---|---:|---:|
| chamber recorder (Giroxa, Watex, Pobeda…) | ~3 kHz | full rate | full rate, level −9 dB |
| bare piezo, direct contact | 8–13 kHz | starved | full rate |
| freesound contact mic (28,800 bph) | high | **0.4 beats/s** | **8.0 beats/s (28,800 locks)** |
| freesound automatic (28,800 bph) | high | 0 beats/s | 7.6 beats/s (28,800 locks) |
| freesound pocket watch (18,000 bph) | 5.8 kHz | 5.0 beats/s | 5.0 beats/s |

Consequences recorded here:

- The pallet-filter slider range is **2000–16000 Hz**; the default stays 4500
  because that is what the reference recordings were measured with.
- The high-pass matters too: one quiet freesound clip had its click at ~700 Hz
  and only detected with the high-pass at 300 Hz instead of 750.
- Clicks below ~2 kHz (pocket watches recorded through air) cannot be matched at
  all, because the band-pass minimum is 2000 Hz.
- Chamber recordings are forgiving: Giroxa still detected 8.0 beats/s and locked
  28,800 at every setting from 3 to 16 kHz, though the snippet peak fell from
  0.016 to 0.006 (−9 dB) as the filter moved off its click band. A high-beat
  movement starved at the wrong setting is the failure to watch for.

## Synthetic fixtures

`test-fixtures/audio/` contains 20 s WAVs with a known **1.5 ms** beat error
and 18,000 bph, including mid-click traps. They are not in the app list; to
test, copy one into `public/recordings/`, reload, use Simulate → Recording,
then remove it. Regenerate with `python3 test-fixtures/audio/generate.py`.
Expected: 18,000 bph and 1.5 ms for every fixture.

## Debug capture (per-beat log)

`src/services/debugCapture.ts` writes one JSON object per beat — interval, lift
time, amplitude, beat error, BPH, noise floor, threshold — plus an optional
70 ms envelope decimated to ~1 kHz. Envelopes are what make a *pick* checkable
after the fact ("did Unlock land on the faint blip or on the burst 10–30 ms
later?"); screenshots of the median-smoothed dashboard cannot answer that.

Off by default. Toggle it in **Calibration & Filter → Capture**.

- **Dev**: lines are POSTed to the plugin in `vite.config.ts`
  (`POST /unruh/__unruh-debug`) and appended to `.unruh-debug/live.ndjson`
  (rotates at 20 MB, gitignored). Read it directly instead of pasting:
  - `jq -r '[.b,.dt,.lift,.amp,.be,.bph]|@tsv' .unruh-debug/live.ndjson | tail -20`
  - `jq -s '[.[]|.lift]|sort|.[length/2]' .unruh-debug/live.ndjson`
  - `jq -c 'select(.lift > 30)' .unruh-debug/live.ndjson`
- **Production** (GitHub Pages) has no endpoint: the buffer stays in memory and
  the panel's **Save** button downloads JSONL.
- **Full-rate snippets** (panel checkbox, off by default) add `pcm`: base64
  Int16 of the same 70 ms snippet, normalised by `peak` (~9 KB/beat, capped at
  500). Decode as `int16/32767 * peak`. Use this for landmark work — at 1 kHz
  the grouping constants lose resolution and Unlock merges into the burst.
  A full-rate replay matches the engine's recorded lift to 0.16 ms mean error.
- **Clear** in the panel rotates the file (`POST …/__unruh-debug/reset`) to
  `live-<timestamp>.ndjson` instead of truncating, so runs can be compared.
- Envelope values are 0–255 *per beat*; the absolute level is in `peak`, so
  gain/contact changes stay visible.
- **Amplitude uncertainty** `±x°` next to the amplitude comes from the IQR of
  the 16 lift times propagated through the amplitude formula. Green ≤5°,
  amber ≤15°, red above — on a long-ringing chamber it is tens of degrees, and
  that is the honest reading.
- **SNR** = `20·log10(peak / noise)`, shown live in the Audio Settings modal and
  the capture panel. It is the practical test of an input setup: digital gain
  scales signal and converter noise together, so a chain sitting at ~30 dB is
  ADC/preamp-limited and needs analog gain or a 24-bit interface, not a bigger
  `gainMultiplier`.
- The recorder is fed from `onBeat` (already outside the ScriptProcessor
  callback). Never call it from inside the audio callback.

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
