/**
 * Unruh Web Audio DSP Engine
 * Fixes waveform trace jumping using a continuous audio ring buffer and
 * fixed-offset T1 edge alignment across Web Audio processing chunks.
 */

import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_WATCH_CONFIG,
} from '../config/defaults';
import {
  AcousticSignature,
  AudioSettings,
  BeatMeasurement,
  BphOption,
  COMMON_BPH_PRESETS,
  WatchConfig,
} from '../types/timegrapher';
import { globalWatchFingerprinter } from './watchFingerprintEngine';

export class AudioEngine {
  private streamStartTime: number = 0;
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private monitorGainNode: GainNode | null = null;
  private highPassNode: BiquadFilterNode | null = null;
  private bandPassNode: BiquadFilterNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;

  // Simulator oscillator / nodes
  private simIntervalId: number | null = null;
  private simTargetNode: GainNode | null = null;
  private recordingSource: AudioBufferSourceNode | null = null;
  /** Ring buffer of recent input waveform samples (chronological, newest last). */
  private waveformRing = new Float32Array(48000);
  private waveformRingHead = 0;
  private waveformRingSize = 0;
  private recordingStartTime = 0;

  private isRunning: boolean = false;
  private isSimulating: boolean = false;
  private isMonitoringActive: boolean = false;
  private monitorVolumeLevel: number = 0.5;

  // Callback handlers
  public onBeat?: (beat: BeatMeasurement) => void;
  public onLevel?: (rms: number, peak: number) => void;
  public onAutoBphDetected?: (detectedBph: BphOption) => void;
  public onAcousticSignature?: (signature: AcousticSignature) => void;

  // Initial state derived from central defaults
  private audioSettings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private watchConfig: WatchConfig = { ...DEFAULT_WATCH_CONFIG };

  // DSP internal state
  private beatCounter: number = 0;
  private totalProcessedSamples: number = 0;
  private lastBeatSampleTime: number = 0;
  private previousHalfPeriodMs: number = 0;
  private isTickTurn: boolean = true;
  private lockoutSamples: number = 0;
  private adaptiveThreshold: number = 0.15;
  private backgroundNoiseLevel: number = 0.02;

  // CONTINUOUS RING BUFFER (200ms window history at 48kHz)
  private readonly RING_SIZE = 19200;
  private ringBuffer = new Float32Array(this.RING_SIZE);
  private ringWriteHead = 0;

  // Rolling rate smoothing buffer
  private recentCycleRates: number[] = [];
  private integrationWindowBeats: number = 6;
  private recentIntervalsMs: number[] = [];
  private recentBeatErrorsMs: number[] = [];

  // Beat grid / gated detection. Once ~8 beats are known, the next beat is
  // predicted from the grid and the loudest impact inside a small gate is
  // accepted. This prevents the detector jumping to a different impact (or a
  // stray click) — the cause of the beat-error jitter.
  private recentBeatTimesMs: number[] = [];
  // Rate needs a long window: a single mechanical beat is only ~0.2 s, so a
  // 1 ms timing wobble is already ~430 s/d. 48 beats (~10 s at 18,000 bph)
  // averages that away while still tracking regulator adjustments.
  private readonly RATE_WINDOW_BEATS = 48;
  // Beat error is a tick-vs-tock comparison, so it only needs a few beats.
  private readonly ERROR_WINDOW_BEATS = 16;
  private predictionSample: number | null = null;
  private gateHalfSamples: number = 0;
  private gateBestSample: number | null = null;
  private gateBestAmp: number = 0;
  /** Decaying max of the recent envelope, used to seed on the loud drop. */
  private recentPeakLevel: number = 0;
  // Auto-BPH hysteresis: a new rate must win several consecutive windows
  // before it is applied, so one noisy window cannot flip 18k <-> 19.8k.
  private pendingBph: number | null = null;
  private pendingBphStreak: number = 0;

  // Simulation parameters
  private _simRate = 0;
  private _simBeatError = 0.2;
  private _simAmplitude = 280;
  private _simNoise = 0.05;

  constructor(
    initialAudioSettings?: Partial<AudioSettings>,
    initialWatchConfig?: Partial<WatchConfig>
  ) {
    if (initialAudioSettings) {
      this.audioSettings = { ...this.audioSettings, ...initialAudioSettings };
    }
    if (initialWatchConfig) {
      this.watchConfig = { ...this.watchConfig, ...initialWatchConfig };
    }
    this.updateLockoutSamples(48000);
  }

  public setIntegrationWindow(beats: number) {
    this.integrationWindowBeats = Math.max(2, beats);
  }

  public updateAudioSettings(newSettings: Partial<AudioSettings>) {
    this.audioSettings = { ...this.audioSettings, ...newSettings };
    if (this.gainNode && newSettings.gainMultiplier !== undefined) {
      this.gainNode.gain.setValueAtTime(
        this.audioSettings.gainMultiplier,
        this.audioCtx?.currentTime || 0
      );
    }
    if (this.highPassNode && newSettings.highPassCutoff !== undefined) {
      this.highPassNode.frequency.setValueAtTime(
        this.audioSettings.highPassCutoff,
        this.audioCtx?.currentTime || 0
      );
    }
    if (this.bandPassNode && newSettings.bandPassFreq !== undefined) {
      this.bandPassNode.frequency.setValueAtTime(
        this.audioSettings.bandPassFreq,
        this.audioCtx?.currentTime || 0
      );
    }
    if (this.audioCtx) {
      this.updateLockoutSamples(this.audioCtx.sampleRate);
    }
  }

  public updateWatchConfig(newConfig: Partial<WatchConfig>) {
    this.watchConfig = { ...this.watchConfig, ...newConfig };
    if (this.audioCtx) {
      this.updateLockoutSamples(this.audioCtx.sampleRate);
    }
  }

  private updateLockoutSamples(sampleRate: number) {
    const targetPeriodMs = 3600000 / this.watchConfig.effectiveBph;
    // The lockout must stay clearly shorter than one beat. Using a fixed
    // 125 ms floor used to equal (or exceed) the half period of fast
    // movements (28800/36000 bph), so every other beat was swallowed and the
    // beat error could never be measured. Scale with the period instead.
    const ratio = this.audioSettings.lockoutRatio > 0 ? this.audioSettings.lockoutRatio : 0.65;
    // Auto mode uses a fixed 125 ms lockout. Scaling it down for a fast
    // (possibly wrongly) detected rate created a feedback loop: the short
    // lockout let extra sounds through, which kept the wrong fast rate alive
    // (e.g. an 18,000 bph pin-lever read as 36,000). 125 ms is long enough to
    // ignore secondary impacts and short enough for the common 18,000–25,200
    // bph movements. A known high-beat movement should be selected manually;
    // in manual mode the lockout is scaled but always stays 15% below the
    // half period so even 28,800/36,000 bph beats are not swallowed.
    const minLockoutMs = this.watchConfig.bphMode === 'auto'
      ? 125
      : Math.min(Math.max(125, targetPeriodMs * ratio), targetPeriodMs * 0.85);
    this.lockoutSamples = Math.floor((minLockoutMs / 1000) * sampleRate);
  }

  public setAudioMonitoring(enabled: boolean, volume?: number) {
    this.isMonitoringActive = enabled;
    if (volume !== undefined) {
      this.monitorVolumeLevel = Math.max(0, Math.min(1.0, volume));
    }
    if (this.monitorGainNode && this.audioCtx) {
      const targetGain = this.isMonitoringActive ? this.monitorVolumeLevel : 0.0;
      this.monitorGainNode.gain.setValueAtTime(targetGain, this.audioCtx.currentTime);
    }
  }

  public getIsMonitoring(): boolean {
    return this.isMonitoringActive;
  }

  public setMonitorVolume(volume: number) {
    this.monitorVolumeLevel = Math.max(0, Math.min(1.0, volume));
    if (this.monitorGainNode && this.audioCtx && this.isMonitoringActive) {
      this.monitorGainNode.gain.setValueAtTime(this.monitorVolumeLevel, this.audioCtx.currentTime);
    }
  }

  public async startMicrophone(deviceId?: string): Promise<boolean> {
    try {
      this.stop();

      const AudioContextClass =
            window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      const sampleRate = this.audioCtx.sampleRate;
      this.updateLockoutSamples(sampleRate);
      this.totalProcessedSamples = 0;
      this.lastBeatSampleTime = 0;
      this.ringWriteHead = 0;
      this.ringBuffer.fill(0);

      const activeDeviceId = deviceId || this.audioSettings.deviceId;

      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: activeDeviceId && activeDeviceId !== 'default' ? { exact: activeDeviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      };

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);

      const now = this.audioCtx.currentTime;
      this.streamStartTime = now;

      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.setValueAtTime(this.audioSettings.gainMultiplier, now);

      this.monitorGainNode = this.audioCtx.createGain();
      this.monitorGainNode.gain.setValueAtTime(
        this.isMonitoringActive ? this.monitorVolumeLevel : 0.0,
        now
      );

      this.highPassNode = this.audioCtx.createBiquadFilter();
      this.highPassNode.type = 'highpass';
      this.highPassNode.frequency.setValueAtTime(2200, now);
      this.highPassNode.Q.setValueAtTime(0.707, now);

      this.bandPassNode = this.audioCtx.createBiquadFilter();
      this.bandPassNode.type = 'bandpass';
      this.bandPassNode.frequency.setValueAtTime(3600, now);
      this.bandPassNode.Q.setValueAtTime(2.2, now);

      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 1024;
      this.analyserNode.smoothingTimeConstant = 0.2;

      this.processorNode = this.audioCtx.createScriptProcessor(2048, 1, 1);
      this.processorNode.onaudioprocess = (e) => this.processAudioBuffer(e);

      // Connect DSP chain
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.highPassNode);
      this.highPassNode.connect(this.bandPassNode);
      this.bandPassNode.connect(this.analyserNode);
      this.bandPassNode.connect(this.processorNode);

      // Connect monitor chain separately to destination (speakers/headphones)
      this.sourceNode.connect(this.monitorGainNode);
      this.monitorGainNode.connect(this.audioCtx.destination);

      // Dummy connection for ScriptProcessor to run
      const muteGain = this.audioCtx.createGain();
      muteGain.gain.setValueAtTime(0, now);
      this.processorNode.connect(muteGain);
      muteGain.connect(this.audioCtx.destination);

      this.isRunning = true;
      this.isSimulating = false;
      return true;
    } catch (err) {
      console.error('Error starting audio input:', err);
      return false;
    }
  }

  public resetToDefaults() {
    this.audioSettings = { ...DEFAULT_AUDIO_SETTINGS };
    this.watchConfig = { ...DEFAULT_WATCH_CONFIG };

    if (this.audioCtx && this.isRunning) {
      this.updateAudioSettings(this.audioSettings);
      this.updateWatchConfig(this.watchConfig);
    }
  }

  public startSimulation(
    bph: BphOption = 21600,
    rateSecondsPerDay: number = 0,
    beatErrorMs: number = 0.2,
    amplitudeDeg: number = 280,
    noiseLevel: number = 0.05
  ) {
    this.stop();
    this.isSimulating = true;
    this.isRunning = true;

    const AudioContextClass =
          window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioContextClass();

    this.watchConfig.effectiveBph = bph;
    const sampleRate = this.audioCtx.sampleRate;
    this.updateLockoutSamples(sampleRate);
    this.totalProcessedSamples = 0;
    this.lastBeatSampleTime = 0;
    this.ringWriteHead = 0;
    this.ringBuffer.fill(0);

    const now = this.audioCtx.currentTime;

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(1.0, now);

    this.monitorGainNode = this.audioCtx.createGain();
    this.monitorGainNode.gain.setValueAtTime(
      this.isMonitoringActive ? this.monitorVolumeLevel : 0.0,
      now
    );

    this.highPassNode = this.audioCtx.createBiquadFilter();
    this.highPassNode.type = 'highpass';
    this.highPassNode.frequency.setValueAtTime(400, now);

    this.analyserNode = this.audioCtx.createAnalyser();
    this.analyserNode.fftSize = 1024;

    this.processorNode = this.audioCtx.createScriptProcessor(2048, 1, 1);
    this.processorNode.onaudioprocess = (e) => this.processAudioBuffer(e);

    this.simTargetNode = this.audioCtx.createGain();
    this.simTargetNode.connect(this.gainNode);
    this.gainNode.connect(this.highPassNode);
    this.highPassNode.connect(this.analyserNode);
    this.highPassNode.connect(this.processorNode);

    // Simulator speaker monitoring connection
    this.simTargetNode.connect(this.monitorGainNode);
    this.monitorGainNode.connect(this.audioCtx.destination);

    const muteGain = this.audioCtx.createGain();
    muteGain.gain.setValueAtTime(0.001, now);
    this.processorNode.connect(muteGain);
    muteGain.connect(this.audioCtx.destination);

    this._simRate = rateSecondsPerDay;
    this._simBeatError = beatErrorMs;
    this._simAmplitude = amplitudeDeg;
    this._simNoise = noiseLevel;

    let isTick = true;
    const scheduleNextSimBeat = () => {
      if (!this.isSimulating || !this.audioCtx) return;

      const targetHalfPeriodSec = 3600 / this.watchConfig.effectiveBph;
      const rateOffsetSec = -(this._simRate / 86400) * targetHalfPeriodSec;
      const beatErrorSec = (this._simBeatError / 1000) * (isTick ? 1 : -1);

      const actualPeriodSec = Math.max(0.05, targetHalfPeriodSec + rateOffsetSec + beatErrorSec);

      this.synthesizeEscapementPulse(this._simAmplitude, this._simNoise);

      isTick = !isTick;
      this.simIntervalId = window.setTimeout(scheduleNextSimBeat, actualPeriodSec * 1000);
    };

    scheduleNextSimBeat();
  }

  public updateSimulationParams(
    rateSecondsPerDay: number,
    beatErrorMs: number,
    amplitudeDeg: number,
    noiseLevel: number
  ) {
    this._simRate = rateSecondsPerDay;
    this._simBeatError = beatErrorMs;
    this._simAmplitude = amplitudeDeg;
    this._simNoise = noiseLevel;
  }

  private synthesizeEscapementPulse(amplitudeDeg: number, noiseLevel: number) {
    if (!this.audioCtx || !this.simTargetNode) return;
    const now = this.audioCtx.currentTime;

    const targetPeriodMs = 3600000 / this.watchConfig.effectiveBph;
    const liftAngle = this.watchConfig.liftAngle;
    const clampedAmp = Math.max(120, Math.min(340, amplitudeDeg));
    // The analyzer derives amplitude as A = liftAngle / (2 * sin(pi * dt / T)),
    // so the simulator places its impulses at dt = (T / pi) * asin(liftAngle / (2 * amp))
    // to make the analyzed amplitude come back as the preset amplitude.
    const arg = liftAngle / (2 * clampedAmp);
    const deltaTSeconds = Math.max(
      0.0029,
      Math.min(0.015, (targetPeriodMs / 1000 / Math.PI) * Math.asin(Math.min(0.99, arg)))
    );

    const bufferSize = Math.floor(this.audioCtx.sampleRate * 0.035);
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const channelData = buffer.getChannelData(0);

    const sr = this.audioCtx.sampleRate;
    const t1Sample = Math.floor(0.002 * sr);
    const t2Sample = Math.floor((0.002 + deltaTSeconds * 0.45) * sr);
    const t3Sample = Math.floor((0.002 + deltaTSeconds) * sr);

    for (let i = 0; i < bufferSize; i++) {
      let sample = 0;
      if (i >= t1Sample) {
        const dt = (i - t1Sample) / sr;
        sample += 0.5 * Math.sin(2 * Math.PI * 4800 * dt) * Math.exp(-dt * 900);
      }
      if (i >= t2Sample) {
        const dt = (i - t2Sample) / sr;
        sample += 0.35 * Math.sin(2 * Math.PI * 3900 * dt) * Math.exp(-dt * 650);
      }
      if (i >= t3Sample) {
        const dt = (i - t3Sample) / sr;
        sample += 0.95 * Math.sin(2 * Math.PI * 5200 * dt) * Math.exp(-dt * 1200);
      }
      sample += (Math.random() * 2 - 1) * noiseLevel;
      channelData[i] = sample;
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.simTargetNode);
    source.start(now);
  }

  private processAudioBuffer(event: AudioProcessingEvent) {
    const inputBuffer = event.inputBuffer.getChannelData(0);
    const sampleRate = event.inputBuffer.sampleRate;
    this.pushWaveform(inputBuffer);
    const len = inputBuffer.length;

    let sumSquares = 0;
    let peak = 0;

    for (let i = 0; i < len; i++) {
      const val = inputBuffer[i];
      const absVal = Math.abs(val);

      this.ringBuffer[this.ringWriteHead] = val;
      this.ringWriteHead = (this.ringWriteHead + 1) % this.RING_SIZE;

      if (absVal > peak) peak = absVal;
      sumSquares += absVal * absVal;
    }

    const rms = Math.sqrt(sumSquares / len);
    if (this.onLevel) this.onLevel(rms, peak);

    // Track the quiet floor, not the average chunk level: loud escapement
    // clicks were inflating the "noise" estimate and pushing the trigger
    // threshold above the quieter tick/tock, so detection hopped between
    // different sub-events (unlock / impulse / banking) of the same beat.
    if (rms < this.backgroundNoiseLevel) {
      this.backgroundNoiseLevel += (rms - this.backgroundNoiseLevel) * 0.2;
    } else {
      this.backgroundNoiseLevel += (rms - this.backgroundNoiseLevel) * 0.002;
    }

    let threshold = this.audioSettings.sensitivityThreshold;
    if (this.audioSettings.autoThreshold) {
      // 3.5× the quiet-floor RMS is only ~3.5σ of the noise; at 48 kHz that
      // still produces several false peaks per second. On a noisy live mic
      // those false peaks fired right after the lockout (125 ms intervals →
      // a bogus 25,200 bph). 5σ leaves the real clicks well above the gate.
      threshold = Math.max(this.audioSettings.noiseGate, this.backgroundNoiseLevel * 5.0);
      this.adaptiveThreshold = threshold;
    }

    // Envelope smoothed over ±0.25 ms. A mechanical click is broadband and
    // the un-smoothed envelope is jagged at the sample level; the old 5-sample
    // box (0.1 ms) let the "loudest" point jump between oscillation peaks on
    // different beats, which showed up as fake beat-error / rate jitter.
    const env = new Float32Array(len);
    const prefix = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) {
      prefix[i + 1] = prefix[i] + Math.abs(inputBuffer[i]);
    }
    const envHalf = Math.max(1, Math.round(0.00025 * sampleRate));
    let chunkEnvPeak = 0;
    for (let i = 0; i < len; i++) {
      const a = Math.max(0, i - envHalf);
      const b = Math.min(len, i + envHalf + 1);
      const val = (prefix[b] - prefix[a]) / (b - a);
      env[i] = val;
      if (val > chunkEnvPeak) chunkEnvPeak = val;
    }
    // Slow decay keeps the reference near the loudest recent impact (the drop).
    this.recentPeakLevel = Math.max(this.recentPeakLevel * 0.98, chunkEnvPeak);

    const chunkStartGlobalSample = this.totalProcessedSamples;
    const chunkEndGlobalSample = chunkStartGlobalSample + len;

    if (this.predictionSample !== null) {
      // Gated mode: predict where the beat should be, then take the loudest
      // impact inside a small gate. The loudest impact is the same physical
      // event (the banking/drop) every beat, so the timing is consistent.
      const gateLo = this.predictionSample - this.gateHalfSamples;
      const gateHi = this.predictionSample + this.gateHalfSamples;
      const scanLo = Math.max(0, gateLo - chunkStartGlobalSample);
      const scanHi = Math.min(len, gateHi - chunkStartGlobalSample);

      for (let i = scanLo; i < scanHi; i++) {
        const val = env[i];
        // In gated mode a beat is known to be here, so take the loudest
        // envelope sample. The old "sharpest local maximum" test could pick
        // a sharper secondary sub-click instead of the loudest impact,
        // moving the beat time by 10–20 ms and inflating the beat error.
        if (val > threshold && val > this.gateBestAmp) {
          this.gateBestAmp = val;
          this.gateBestSample = chunkStartGlobalSample + i;
        }
      }

      if (chunkEndGlobalSample >= gateHi) {
        const best = this.gateBestSample;
        this.gateBestSample = null;
        this.gateBestAmp = 0;
        this.predictionSample = null;
        if (best !== null) {
          this.handleDetectedBeatFromRing(best, sampleRate);
        }
      }
    } else {
      // Warm-up / recovery: free-running detection until the grid is ready.
      // Seed only on the loudest impact of each beat (the drop). Without this
      // the low threshold double-detects and the grid locks onto 36,000.
      for (let i = 4; i < len - 4; i++) {
        const val = env[i];

        if (
          val > threshold &&
            val > this.recentPeakLevel * 0.6 &&
            val >= env[i - 1] &&
            val >= env[i - 2] &&
            val > env[i + 1] &&
            val > env[i + 2]
        ) {
          const absoluteSampleIndex = chunkStartGlobalSample + i;
          const samplesSinceLast = absoluteSampleIndex - this.lastBeatSampleTime;

          if (samplesSinceLast >= this.lockoutSamples) {
            this.handleDetectedBeatFromRing(absoluteSampleIndex, sampleRate);
            break;
          }
        }
      }
    }

    this.totalProcessedSamples += len;
  }

  private handleDetectedBeatFromRing(globalTriggerSample: number, sampleRate: number) {
    this.beatCounter++;
    const now = performance.now();

    const samplesAgo = this.totalProcessedSamples + 2048 - globalTriggerSample;
    const triggerRingIdx = (this.ringWriteHead - samplesAgo + this.RING_SIZE) % this.RING_SIZE;

    // 1. Locate peak burst near trigger
    const tightWindow = Math.floor(0.005 * sampleRate);
    let peakAmp = 0;
    let peakIdx = triggerRingIdx;

    for (let k = -tightWindow; k <= tightWindow; k++) {
      const idx = (triggerRingIdx + k + this.RING_SIZE) % this.RING_SIZE;
      const absVal = Math.abs(this.ringBuffer[idx]);
      if (absVal > peakAmp) {
        peakAmp = absVal;
        peakIdx = idx;
      }
    }

    // 2. Scan backward to locate the first escapement sound (the unlock).
    //    The old scan compared single samples: the click oscillates through
    //    zero many times, so it could stop on a zero crossing right at the
    //    peak or several milliseconds early in a random gap — the snippet
    //    then started at a different place on every beat. Use a smoothed
    //    envelope and a noise-relative threshold instead.
    const envHalf = Math.max(2, Math.floor(0.000125 * sampleRate)); // ±0.125 ms
    const ringEnv = (idx: number): number => {
      let s = 0;
      for (let k = -envHalf; k <= envHalf; k++) {
        s += Math.abs(this.ringBuffer[(idx + k + this.RING_SIZE) % this.RING_SIZE]);
      }
      return s / (2 * envHalf + 1);
    };

    // Quiet gap before the beat = local noise floor (8–20 ms before the peak).
    let localNoise = Number.POSITIVE_INFINITY;
    const noiseNear = Math.floor(0.008 * sampleRate);
    const noiseFar = Math.floor(0.020 * sampleRate);
    for (let k = noiseNear; k <= noiseFar; k += 4) {
      localNoise = Math.min(localNoise, ringEnv(peakIdx - k));
    }
    if (!Number.isFinite(localNoise)) localNoise = this.backgroundNoiseLevel;

    const peakEnv = ringEnv(peakIdx);
    const onsetThreshold = localNoise + Math.max(peakEnv - localNoise, 1e-6) * 0.08;

    let trueT1Idx = peakIdx;
    let quietRun = 0;
    const quietNeeded = Math.max(2, Math.floor(0.00025 * sampleRate));
    const maxBackScan = Math.floor(0.030 * sampleRate);

    for (let k = 1; k <= maxBackScan; k++) {
      const idx = (peakIdx - k + this.RING_SIZE) % this.RING_SIZE;
      if (ringEnv(idx) < onsetThreshold) {
        quietRun++;
        if (quietRun >= quietNeeded) {
          trueT1Idx = (peakIdx - k + quietNeeded + this.RING_SIZE) % this.RING_SIZE;
          break;
        }
      } else {
        quietRun = 0;
      }
    }

    // 3. Extract snippet anchored with exactly 2ms pre-roll before T1
    //    (used for the acoustic fingerprint — 45 ms keeps profile matching stable)
    const snippetSamples = Math.floor(0.045 * sampleRate);
    const preRollSamples = Math.floor(0.002 * sampleRate);
    const startRingIdx = (trueT1Idx - preRollSamples + this.RING_SIZE) % this.RING_SIZE;

    const snippet = new Float32Array(snippetSamples);
    for (let j = 0; j < snippetSamples; j++) {
      const rIdx = (startRingIdx + j) % this.RING_SIZE;
      snippet[j] = this.ringBuffer[rIdx];
    }

    // 3b. Wider window for the escapement pulse display, anchored to the
    //     detected pulse peak. This is stable from beat to beat, so the
    //     waveform no longer jumps around while the pulses are inspected.
    // Wider window + anchor on the loudest impact (the drop), so the quiet
    // unlocking/impulse click 15–25 ms earlier is inside the window on every
    // beat. (Visually confirmed: the EB 8800 balance amplitude is low, so the
    // pre-impact is the unlock, not an overbanking artefact.)
    const scopeSamples = Math.floor(0.070 * sampleRate);
    const scopePreRoll = Math.floor(0.035 * sampleRate);
    const scopeWindow = Math.floor(0.035 * sampleRate);
    let scopeIdx = peakIdx;
    let scopeAmp = 0;
    for (let k = -scopeWindow; k <= scopeWindow; k++) {
      const idx = (triggerRingIdx + k + this.RING_SIZE) % this.RING_SIZE;
      const absVal = Math.abs(this.ringBuffer[idx]);
      if (absVal > scopeAmp) {
        scopeAmp = absVal;
        scopeIdx = idx;
      }
    }
    const scopeStartIdx = (scopeIdx - scopePreRoll + this.RING_SIZE) % this.RING_SIZE;
    const scopeSnippet = new Float32Array(scopeSamples);
    for (let j = 0; j < scopeSamples; j++) {
      scopeSnippet[j] = this.ringBuffer[(scopeStartIdx + j) % this.RING_SIZE];
    }

    const targetPeriodMs = 3600000 / this.watchConfig.effectiveBph;

    // Time the beat from the first visible escapement impact (the unlock) —
    // the same peak the escapement scope labels t1 — not from the loudest
    // sub-click. On low-amplitude movements the loudest can swap between the
    // unlock and the banking/drop (10–35 ms apart), which made the beat error
    // jump between clusters (e.g. 2 ms / 19 ms / 35 ms).
    const impulses = this.analyzeEscapementImpulses(
      scopeSnippet,
      sampleRate,
      targetPeriodMs,
      this.watchConfig.liftAngle
    );
    let scopeDelta = scopeIdx - triggerRingIdx;
    if (scopeDelta > this.RING_SIZE / 2) scopeDelta -= this.RING_SIZE;
    if (scopeDelta < -this.RING_SIZE / 2) scopeDelta += this.RING_SIZE;
    const scopeStartGlobal = globalTriggerSample + scopeDelta - scopePreRoll;
    const beatGlobalSample =
      scopeStartGlobal + Math.round((impulses.t1Ms / 1000) * sampleRate);

    let currentHalfPeriodMs = targetPeriodMs;
    if (this.lastBeatSampleTime > 0) {
      const deltaSamples = beatGlobalSample - this.lastBeatSampleTime;
      currentHalfPeriodMs = (deltaSamples / sampleRate) * 1000;

      if (
        currentHalfPeriodMs > targetPeriodMs * 1.50 ||
          currentHalfPeriodMs < targetPeriodMs * 0.50
      ) {
        this.previousHalfPeriodMs = 0;
        // A skipped beat breaks the phase: restart the grid/recovery.
        this.recentBeatTimesMs = [];
        this.predictionSample = null;
        this.gateBestSample = null;
        this.gateBestAmp = 0;
        this.lastBeatSampleTime = beatGlobalSample;
        return;
      }
    }

    this.recentBeatTimesMs.push((beatGlobalSample / sampleRate) * 1000);
    if (this.recentBeatTimesMs.length > this.RATE_WINDOW_BEATS * 2) {
      this.recentBeatTimesMs.shift();
    }

    const rateGrid = this.computeGrid(this.recentBeatTimesMs, this.RATE_WINDOW_BEATS);
    const robustBeatError = rateGrid
      ? this.computeBeatError(
          this.recentBeatTimesMs,
          this.ERROR_WINDOW_BEATS,
          rateGrid.slopeMs
        )
      : null;

    if (currentHalfPeriodMs > 70 && currentHalfPeriodMs < 300) {
      this.recentIntervalsMs.push(currentHalfPeriodMs);
      if (this.recentIntervalsMs.length > 25) {
        this.recentIntervalsMs.shift();
      }
      if (this.watchConfig.bphMode === 'auto' && this.recentIntervalsMs.length >= 8) {
        this.checkAutoBph();
      }
    }

    let rateErrorSecondsPerDay = 0;
    let beatErrorMs = 0.1;

    if (this.previousHalfPeriodMs > 0) {
      const rawBeatError = Math.abs(currentHalfPeriodMs - this.previousHalfPeriodMs) / 2;
      // Sanity cap only. A badly out-of-beat lever movement can measure well
      // above 10 ms; capping at 9.9/19.9 made the reading look frozen while
      // the stud was being adjusted.
      const boundedBeatError = Math.min(49.9, Math.max(0, rawBeatError));

      this.recentBeatErrorsMs.push(boundedBeatError);
      if (this.recentBeatErrorsMs.length > 5) {
        this.recentBeatErrorsMs.shift();
      }

      const sortedErrors = [...this.recentBeatErrorsMs].sort((a, b) => a - b);
      beatErrorMs = sortedErrors[Math.floor(sortedErrors.length / 2)];

      const fullCyclePeriodMs = currentHalfPeriodMs + this.previousHalfPeriodMs;
      const targetCyclePeriodMs = targetPeriodMs * 2;
      const rawCycleRate =
            ((targetCyclePeriodMs - fullCyclePeriodMs) / targetCyclePeriodMs) * 86400;
      // Generous sanity clamp (±1 hour/day). The old ±400 clamp hid a very
      // fast (or magnetised) watch behind a plausible-looking "+400 s/d".
      const boundedRate = Math.max(-3600, Math.min(3600, rawCycleRate));

      this.recentCycleRates.push(boundedRate);
      if (this.recentCycleRates.length > this.integrationWindowBeats) {
        this.recentCycleRates.shift();
      }

      if (this.recentCycleRates.length >= 3) {
        // Median rather than a trimmed mean: on a pin-lever an occasional
        // interrupted cycle produces a huge outlier, and the mean let several
        // of them pull the displayed rate around. The median ignores them.
        const sorted = [...this.recentCycleRates].sort((a, b) => a - b);
        rateErrorSecondsPerDay = sorted[Math.floor(sorted.length / 2)];
      } else {
        rateErrorSecondsPerDay = boundedRate;
      }
    } else {
      rateErrorSecondsPerDay = ((targetPeriodMs - currentHalfPeriodMs) / targetPeriodMs) * 86400;
      beatErrorMs = 0.0;
    }

    // Grid window-average: steadier than per-interval differences.
    // Beat error uses a short window (it is a tick-vs-tock comparison); the
    // rate uses a long window so mechanical jitter is averaged out.
    if (robustBeatError !== null) beatErrorMs = robustBeatError;
    if (rateGrid) rateErrorSecondsPerDay = rateGrid.rate;

    this.previousHalfPeriodMs = currentHalfPeriodMs;
    this.lastBeatSampleTime = beatGlobalSample;
    this.isTickTurn = !this.isTickTurn;

    const { deltaTMs, amplitude, t1Ms, t2Ms, t3Ms } = impulses;

    // Debugging verification outputs
    if (this.audioSettings.debug === true) {
      console.log(
        `[AudioEngine Beat #${this.beatCounter}] T1: ${t1Ms.toFixed(2)}ms | T2: ${t2Ms.toFixed(2)}ms | T3: ${t3Ms.toFixed(2)}ms | Δt: ${deltaTMs.toFixed(2)}ms | Amp: ${amplitude}°`
      );
      this.debugInspectSnippet(scopeSnippet, sampleRate, t1Ms, t2Ms, t3Ms);
    }

    const measurement: BeatMeasurement = {
      id: this.beatCounter,
      timestamp: now,
      measuredPeriodMs: currentHalfPeriodMs,
      targetPeriodMs,
      rateErrorSecondsPerDay,
      beatErrorMs,
      amplitudeDeg: amplitude,
      isTick: this.isTickTurn,
      deltaTImpulseMs: deltaTMs,
      t1Ms,
      t2Ms,
      t3Ms,
      waveformSnippet: scopeSnippet,
      snippetSampleRate: sampleRate,
    };

    const isWarmingUp =
          !this.isSimulating &&
            this.audioCtx &&
            this.audioCtx.currentTime - this.streamStartTime < this.audioSettings.warmUpDelay;

    if (!isWarmingUp && this.onBeat) {
      this.onBeat(measurement);
    }

    if (!isWarmingUp && this.onAcousticSignature && this.beatCounter % 3 === 0) {
      const freqData = new Uint8Array(
        this.analyserNode ? this.analyserNode.frequencyBinCount : 64
      );
      if (this.analyserNode) {
        this.analyserNode.getByteFrequencyData(freqData);
      }
      const sig = globalWatchFingerprinter.extractSignature(
        snippet,
        sampleRate,
        this.watchConfig.effectiveBph,
        deltaTMs,
        freqData
      );
      this.onAcousticSignature(sig);
    }

    // Predict the next beat from the grid; the gated detector will then take
    // the loudest impact near that prediction.
    if (rateGrid) {
      this.predictionSample =
        beatGlobalSample + Math.round((rateGrid.slopeMs / 1000) * sampleRate);
      this.gateHalfSamples = Math.round(((rateGrid.slopeMs * 0.25) / 1000) * sampleRate);
    } else {
      this.predictionSample = null;
    }
  }

  private analyzeEscapementImpulses(
    snippet: Float32Array,
    sampleRate: number,
    targetPeriodMs: number,
    liftAngle: number
  ): { deltaTMs: number; amplitude: number; t1Ms: number; t2Ms: number; t3Ms: number } {
    const len = snippet.length;
    const win = 3;

    // 1. Smoothed envelope (moving average of |signal| over ±3 samples)
    const envelope = new Float32Array(len);
    for (let i = win; i < len - win; i++) {
      let sum = 0;
      for (let k = -win; k <= win; k++) {
        sum += Math.abs(snippet[i + k]);
      }
      envelope[i] = sum / (2 * win + 1);
    }

    // 2. Global maximum. The window opens ~15 ms before the detected pulse,
    //    so its first milliseconds are a quiet local-noise reference.
    let maxVal = 0;
    let maxIdx = win;
    for (let i = win; i < len - win; i++) {
      if (envelope[i] > maxVal) {
        maxVal = envelope[i];
        maxIdx = i;
      }
    }
    if (!(maxVal > 0)) {
      return { deltaTMs: 4, amplitude: 260, t1Ms: 2, t2Ms: 3, t3Ms: 7 };
    }

    let noise = Number.POSITIVE_INFINITY;
    const noiseEnd = Math.min(len - win, Math.floor(0.010 * sampleRate));
    for (let i = win; i < noiseEnd; i += 4) {
      noise = Math.min(noise, envelope[i]);
    }
    if (!Number.isFinite(noise)) noise = 0;
    const dyn = Math.max(maxVal - noise, 1e-6);

    // 3. Find the distinct, visible impacts: local maxima with enough height
    //    and prominence, merged when they belong to the same click.
    const minGap = Math.max(2, Math.floor(0.0012 * sampleRate));
    const promWin = Math.max(2, Math.floor(0.0015 * sampleRate));
    const searchEnd = Math.min(len - win - 1, Math.floor(0.065 * sampleRate));
    const peaks: { idx: number; val: number }[] = [];

    for (let i = win + minGap; i < searchEnd; i++) {
      // Ignore low-level noise/rumble before the beat; only real impacts.
      if (envelope[i] < noise + dyn * 0.25) continue;
      if (!(envelope[i] >= envelope[i - 1] && envelope[i] > envelope[i + 1])) continue;

      let lmin = envelope[i];
      let rmin = envelope[i];
      for (let j = Math.max(0, i - promWin); j <= i; j++) lmin = Math.min(lmin, envelope[j]);
      for (let j = i; j <= Math.min(len - 1, i + promWin); j++) rmin = Math.min(rmin, envelope[j]);
      const prominence = envelope[i] - Math.max(lmin, rmin);
      if (prominence < dyn * 0.12) continue;

      const prev = peaks[peaks.length - 1];
      if (prev && i - prev.idx < minGap) {
        if (envelope[i] > prev.val) peaks[peaks.length - 1] = { idx: i, val: envelope[i] };
      } else {
        peaks.push({ idx: i, val: envelope[i] });
      }
    }

    if (peaks.length === 0) {
      peaks.push({ idx: maxIdx, val: maxVal });
    }

    // Escapement order: unlocking (first, quiet) → impulse → drop (loudest).
    // T1 = first impact, T3 = loudest impact, Δt = unlock → drop. This is the
    // timing-machine definition; counting only the ring-down under-read Δt and
    // over-read the amplitude (350° instead of the visually low real swing).
    const t1Peak = peaks[0];
    let t3Peak = peaks[0];
    for (const p of peaks) {
      if (p.val > t3Peak.val) t3Peak = p;
    }
    // The impulse sits between the unlock and the drop, not on the banking
    // impact. Search only the first 60 % of the unlock→drop span so t2 does
    // not drift onto the drop's leading lobes.
    const impulseLimit = t1Peak.idx + Math.floor((t3Peak.idx - t1Peak.idx) * 0.6);
    let t2Peak = t1Peak;
    for (const p of peaks) {
      if (p.idx > t1Peak.idx && p.idx <= impulseLimit && p.val > t2Peak.val) t2Peak = p;
    }
    if (t3Peak.idx <= t1Peak.idx) {
      t3Peak = t1Peak;
      t2Peak = t1Peak;
    }

    const t1Ms = (t1Peak.idx / sampleRate) * 1000;
    const t2Ms = (t2Peak.idx / sampleRate) * 1000;
    const t3Ms = (t3Peak.idx / sampleRate) * 1000;

    let deltaTMs = t3Ms - t1Ms;
    // The unlock→drop span on these pin-lever movements can be 20–40 ms;
    // the old 16 ms ceiling hid a low (real) amplitude.
    deltaTMs = Math.max(2.5, Math.min(45.0, deltaTMs));

    // 7. Amplitude Calculation
    const liftAngleRad = (liftAngle * Math.PI) / 180;
    const omegaT = (Math.PI * deltaTMs) / targetPeriodMs;
    const sinVal = Math.sin(omegaT);

    let amplitude = 260;
    if (sinVal > 0.01) {
      const ampRad = liftAngleRad / (2 * sinVal);
      amplitude = Math.round((ampRad * 180) / Math.PI);
      // Show a genuinely low amplitude instead of clamping it up to 120°.
      amplitude = Math.max(40, Math.min(360, amplitude));
    }

    return { deltaTMs, amplitude, t1Ms, t2Ms, t3Ms };
  }

  private debugInspectSnippet(
    snippet: Float32Array,
    sampleRate: number,
    t1Ms: number,
    t2Ms: number,
    t3Ms: number
  ) {
    const t1Idx = Math.round((t1Ms / 1000) * sampleRate);
    const t2Idx = Math.round((t2Ms / 1000) * sampleRate);
    const t3Idx = Math.round((t3Ms / 1000) * sampleRate);

    console.groupCollapsed(`[Snippet Sample Inspection - Beat #${this.beatCounter}]`);
    console.log(`Sample Rate: ${sampleRate} Hz | Total Snippet Samples: ${snippet.length}`);
    console.log(`T1 (Unlock) Index: ${t1Idx} [Val: ${snippet[t1Idx]?.toFixed(4)}]`);
    console.log(`T2 (Impulse) Index: ${t2Idx} [Val: ${snippet[t2Idx]?.toFixed(4)}]`);
    console.log(`T3 (Banking) Index: ${t3Idx} [Val: ${snippet[t3Idx]?.toFixed(4)}]`);
    console.groupEnd();
  }

  /**
   * Solve the 3-parameter grid model
   *   t_i = a + b·i + c·(-1)^i
   * b is the average beat period (ms), c is half the tick/tock offset.
   * The alternating term is part of the model, so a large beat error does
   * not tilt the rate, and the residuals are pure timing noise.
   */
  private fitGrid(
    times: number[],
    indices: number[]
  ): { a: number; b: number; c: number } | null {
    const n = times.length;
    if (n < 3) return null;

    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let sp = 0;
    let sip = 0;
    let st = 0;
    let sit = 0;
    let spt = 0;

    for (let k = 0; k < n; k++) {
      const i = indices[k];
      const p = i % 2 === 0 ? 1 : -1;
      const t = times[k];
      s0 += 1;
      s1 += i;
      s2 += i * i;
      sp += p;
      sip += i * p;
      st += t;
      sit += i * t;
      spt += p * t;
    }

    // 3x3 normal equations:
    // [s0  s1   sp ] [a]   [st ]
    // [s1  s2   sip] [b] = [sit]
    // [sp  sip  s0 ] [c]   [spt]
    const m = [
      [s0, s1, sp, st],
      [s1, s2, sip, sit],
      [sp, sip, s0, spt],
    ];

    // Gaussian elimination with partial pivoting.
    for (let col = 0; col < 3; col++) {
      let pivot = col;
      for (let row = col + 1; row < 3; row++) {
        if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
      }
      if (Math.abs(m[pivot][col]) < 1e-9) return null;
      if (pivot !== col) {
        const tmp = m[col];
        m[col] = m[pivot];
        m[pivot] = tmp;
      }
      for (let row = col + 1; row < 3; row++) {
        const f = m[row][col] / m[col][col];
        for (let k = col; k < 4; k++) m[row][k] -= f * m[col][k];
      }
    }

    const c = m[2][3] / m[2][2];
    const b = (m[1][3] - m[1][2] * c) / m[1][1];
    const a = (m[0][3] - m[0][1] * b - m[0][2] * c) / m[0][0];
    return { a, b, c };
  }

  /**
   * Robust grid fit over a window of recent beat times.
   * Mis-detected beats (a click missed, an echo picked) produce residuals
   * far larger than the beat jitter; they are dropped and the fit repeated
   * so one bad beat cannot throw the displayed rate by hundreds of s/d.
   */
  private computeGrid(
    timesMs: number[],
    windowBeats: number
  ): { slopeMs: number; beatErrorMs: number; rate: number } | null {
    const n = Math.min(timesMs.length, windowBeats);
    if (n < 8) return null;

    let times = timesMs.slice(-n);
    let indices = Array.from({ length: n }, (_, i) => i);

    let fit = this.fitGrid(times, indices);
    if (!fit) return null;

    for (let pass = 0; pass < 2; pass++) {
      const residuals = times.map((t, k) => {
        const i = indices[k];
        return t - (fit!.a + fit!.b * i + (i % 2 === 0 ? fit!.c : -fit!.c));
      });
      const sortedAbs = residuals.map(Math.abs).sort((x, y) => x - y);
      const medianAbs = sortedAbs[Math.floor(sortedAbs.length / 2)];
      // The alternating term is already modelled; what remains should be a
      // few ms. Cap the gate at 8 ms so a stray click is always rejected.
      const limit = Math.max(3, Math.min(8, medianAbs * 4));

      const keptTimes: number[] = [];
      const keptIndices: number[] = [];
      for (let k = 0; k < n; k++) {
        if (Math.abs(residuals[k]) <= limit) {
          keptTimes.push(times[k]);
          keptIndices.push(indices[k]);
        }
      }
      if (keptTimes.length < 8 || keptTimes.length === times.length) break;

      const refit = this.fitGrid(keptTimes, keptIndices);
      if (!refit) break;
      times = keptTimes;
      indices = keptIndices;
      fit = refit;
    }

    const targetMs = 3600000 / this.watchConfig.effectiveBph;
    return {
      slopeMs: fit.b,
      beatErrorMs: Math.min(49.9, Math.max(0, 2 * Math.abs(fit.c))),
      rate: Math.max(-3600, Math.min(3600, ((targetMs - fit.b) / targetMs) * 86400)),
    };
  }

  /**
   * Beat error from the last few beats, referred to the long-window rate
   * slope. Tick and tock times are compared group-wise using their medians,
   * so one mis-detected beat (a click picked 10–20 ms off) cannot move the
   * reading — which a plain alternating mean can.
   */
  private computeBeatError(
    timesMs: number[],
    windowBeats: number,
    slopeMs: number
  ): number {
    const n = Math.min(timesMs.length, windowBeats);
    if (n < 8) return 0;

    const times = timesMs.slice(-n);
    const offsets = times.map((t, i) => t - slopeMs * i);
    const sortedOffsets = [...offsets].sort((a, b) => a - b);
    const offset = sortedOffsets[Math.floor(sortedOffsets.length / 2)];

    const even: number[] = [];
    const odd: number[] = [];
    for (let i = 0; i < n; i++) {
      const residual = times[i] - (slopeMs * i + offset);
      (i % 2 === 0 ? even : odd).push(residual);
    }
    if (even.length === 0 || odd.length === 0) return 0;

    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };

    return Math.min(49.9, Math.max(0, Math.abs(median(even) - median(odd))));
  }

  private checkAutoBph() {
    const intervals = this.recentIntervalsMs;
    if (intervals.length < 4) return;

    // Derive the half period from full tick+tock cycles. Averaging the raw
    // half periods makes the median land on the fast half when the watch is
    // badly out of beat, which used to select the wrong BPH preset.
    const cycles: number[] = [];
    for (let i = intervals.length - 1; i >= 1 && cycles.length < 12; i -= 2) {
      cycles.push(intervals[i] + intervals[i - 1]);
    }
    cycles.sort((a, b) => a - b);
    const cycleHalfMs = cycles[Math.floor(cycles.length / 2)] / 2;

    // Trimmed mean (not the median) of the raw intervals: with a large beat
    // error the intervals alternate T-B / T+B, so the median lands on the
    // fast half and the rate flips between neighbouring presets (18k/19.8k).
    // The mean of both halves is T.
    const sorted = [...intervals].sort((a, b) => a - b);
    const trim = sorted.length >= 10 ? Math.floor(sorted.length * 0.1) : 0;
    const kept = sorted.slice(trim, sorted.length - trim);
    const rawCenterMs = kept.reduce((a, b) => a + b, 0) / kept.length;

    // Require agreement from both estimates. Cycle pairing alone can be
    // fooled by a spurious detection inside a beat (secondary click/echo):
    // the pair then looks like a full cycle of a twice-as-fast movement
    // (e.g. a 21,600 bph watch "detected" as 36,000 bph). The cycle estimate
    // decides between neighbouring presets because it cancels the beat-error
    // alternation.
    let closestPreset: (typeof COMMON_BPH_PRESETS)[number] | null = null;
    let minScore = Number.POSITIVE_INFINITY;

    for (const preset of COMMON_BPH_PRESETS) {
      const cycleDiff = Math.abs(preset.periodMs - cycleHalfMs) / preset.periodMs;
      const rawDiff = Math.abs(preset.periodMs - rawCenterMs) / preset.periodMs;
      if (cycleDiff < 0.15 && rawDiff < 0.15) {
        const score = cycleDiff * 2 + rawDiff;
        if (score < minScore) {
          minScore = score;
          closestPreset = preset;
        }
      }
    }

    // The (long-window) grid slope is the most reliable BPH estimate once
    // enough beats are in the window; use it to confirm the candidate.
    const grid = this.computeGrid(this.recentBeatTimesMs, this.RATE_WINDOW_BEATS);
    if (grid) {
      const measuredBph = 3600000 / grid.slopeMs;
      let best: (typeof COMMON_BPH_PRESETS)[number] | null = null;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (const preset of COMMON_BPH_PRESETS) {
        const d = Math.abs(preset.bph - measuredBph) / preset.bph;
        if (d < bestDiff) {
          bestDiff = d;
          best = preset;
        }
      }
      if (best && bestDiff < 0.08) closestPreset = best;
    }

    if (!closestPreset) {
      this.pendingBph = null;
      this.pendingBphStreak = 0;
      return;
    }

    if (this.watchConfig.effectiveBph === closestPreset.bph) {
      this.pendingBph = null;
      this.pendingBphStreak = 0;
      return;
    }

    if (this.pendingBph === closestPreset.bph) {
      this.pendingBphStreak++;
    } else {
      this.pendingBph = closestPreset.bph;
      this.pendingBphStreak = 1;
    }

    // Three consecutive agreeing windows (~3 beats) before switching rate.
    if (this.pendingBphStreak < 3) return;

    this.pendingBph = null;
    this.pendingBphStreak = 0;
    this.watchConfig.effectiveBph = closestPreset.bph;
    if (this.audioCtx) {
      this.updateLockoutSamples(this.audioCtx.sampleRate);
    }
    if (this.onAutoBphDetected) {
      this.onAutoBphDetected(closestPreset.bph);
    }
  }

  public stop() {
    this.isRunning = false;
    this.isSimulating = false;
    this.stopRecording();

    if (this.simIntervalId !== null) {
      clearTimeout(this.simIntervalId);
      this.simIntervalId = null;
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }
    if (this.bandPassNode) {
      this.bandPassNode.disconnect();
      this.bandPassNode = null;
    }
    if (this.highPassNode) {
      this.highPassNode.disconnect();
      this.highPassNode = null;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
    if (this.monitorGainNode) {
      this.monitorGainNode.disconnect();
      this.monitorGainNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }

    this.recentIntervalsMs = [];
    this.recentBeatErrorsMs = [];
    this.recentCycleRates = [];
    this.pendingBph = null;
    this.pendingBphStreak = 0;
    this.recentBeatTimesMs = [];
    this.predictionSample = null;
    this.gateBestSample = null;
    this.gateBestAmp = 0;
    this.recentPeakLevel = 0;
    this.lastBeatSampleTime = 0;
    this.previousHalfPeriodMs = 0;
  }

  /** Stop the generated simulator beat pulses (used when a recording plays instead). */
  public stopSimulationPulses(): void {
    if (this.simIntervalId !== null) {
      clearTimeout(this.simIntervalId);
      this.simIntervalId = null;
    }
  }

  /** Stop the playing recording. */
  public stopRecording(): void {
    if (this.recordingSource) {
      try { this.recordingSource.stop(); } catch { /* ignore */ }
      try { this.recordingSource.disconnect(); } catch { /* ignore */ }
      this.recordingSource = null;
    }
  }

  /**
   * Clear beat/grid/auto-BPH state so a new recording starts fresh. The
   * previous file's noise floor is especially important: a loud file raises
   * the 5σ gate above a quieter watch's clicks and nothing is detected.
   */
  private resetDetectionState(): void {
    this.recentIntervalsMs = [];
    this.recentBeatErrorsMs = [];
    this.recentCycleRates = [];
    this.recentBeatTimesMs = [];
    this.pendingBph = null;
    this.pendingBphStreak = 0;
    this.predictionSample = null;
    this.gateBestSample = null;
    this.gateBestAmp = 0;
    this.recentPeakLevel = 0;
    this.lastBeatSampleTime = 0;
    this.previousHalfPeriodMs = 0;
    this.backgroundNoiseLevel = 0.02;
    this.adaptiveThreshold = 0.15;

    // In auto mode start from the middle preset. Keeping the previous file's
    // BPH can leave a short lockout (e.g. 28,800) that lets the warm-up lock
    // onto secondary clicks of a slower watch, after which the auto detector
    // never recovers. 21,600 is close enough to 18k/28.8k to bootstrap both.
    if (this.watchConfig.bphMode === 'auto') {
      this.watchConfig.effectiveBph = 21600;
      if (this.audioCtx) this.updateLockoutSamples(this.audioCtx.sampleRate);
      this.onAutoBphDetected?.(21600);
    }
  }

  /**
   * Play a recording from the recordings folder through the app's analysis
   * pipeline — the same path used by Live Mic — and stop the generated
   * simulator pulses. The recording loops so the watch keeps "ticking".
   */
  public async startRecording(buffer: ArrayBuffer): Promise<boolean> {
    if (!this.audioCtx || !this.gainNode) return false;
    // Selecting another recording used to leave the previous BufferSource
    // looping into the same gain node, so two watches played at once and the
    // detector measured their mixed clicks.
    this.stopRecording();
    this.stopSimulationPulses();
    // Every recording can have a different level and beat rate. Start the
    // detector from a clean slate, including the noise floor; otherwise the
    // previous (possibly louder) file's floor/BPH can hide the new beats.
    this.resetDetectionState();
    // If Live Mic is active, stop the mic input but keep the audio graph alive.
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }
    }
    try {
      const decoded = await this.audioCtx.decodeAudioData(buffer);
      const source = this.audioCtx.createBufferSource();
      source.buffer = decoded;
      source.loop = true;
      source.connect(this.gainNode);
      this.recordingSource = source;
      this.recordingStartTime = this.audioCtx.currentTime;
      this.streamStartTime = this.audioCtx.currentTime;
      source.start(0);
      this.isRunning = true;
      this.isSimulating = true;
      return true;
    } catch (e) {
      console.error('Failed to play recording:', e);
      return false;
    }
  }

  // --- Public Getters required by App.tsx ---
  public getIsRunning(): boolean {
    return this.isRunning;
  }

  public getIsSimulating(): boolean {
    return this.isSimulating;
  }

  public getAdaptiveThreshold(): number {
    return this.adaptiveThreshold;
  }

  /**
   * Snapshot of the detector state for remote debugging (the "Copy debug"
   * button next to the BPH selector). Contains no audio, only numbers.
   */
  public getDiagnostics() {
    const sampleRate = this.audioCtx?.sampleRate ?? null;
    return {
      bphMode: this.watchConfig.bphMode,
      effectiveBph: this.watchConfig.effectiveBph,
      sampleRate,
      lockoutSamples: this.lockoutSamples,
      lockoutMs: sampleRate ? +((this.lockoutSamples / sampleRate) * 1000).toFixed(1) : null,
      backgroundNoiseLevel: +this.backgroundNoiseLevel.toFixed(5),
      adaptiveThreshold: +this.adaptiveThreshold.toFixed(5),
      recentIntervalsMs: this.recentIntervalsMs.slice(-25).map((v) => +v.toFixed(2)),
      recentBeatErrorsMs: this.recentBeatErrorsMs.map((v) => +v.toFixed(2)),
      recentCycleRates: this.recentCycleRates.slice(-10).map((v) => +v.toFixed(1)),
      beatCounter: this.beatCounter,
      hasMicrophone: !!this.mediaStream,
      hasRecording: !!this.recordingSource,
      isSimulating: this.isSimulating,
    };
  }

  /**
   * Recent input waveform samples (chronological, newest last) — used by the
   * WaveformViewer to draw the live audio waveform.
   */
  public getWaveform(): Float32Array {
    const n = this.waveformRingSize;
    if (n === 0) return new Float32Array(0);
    const out = new Float32Array(n);
    const size = this.waveformRing.length;
    const start = ((this.waveformRingHead - n) % size + size) % size;
    for (let i = 0; i < n; i++) {
      out[i] = this.waveformRing[(start + i) % size];
    }
    return out;
  }

  /** Progress of the playing recording (null when no recording is playing). */
  public getRecordingProgress(): { elapsedSec: number; totalSec: number; playing: boolean } | null {
    if (!this.recordingSource) return null;
    const buffer = this.recordingSource.buffer;
    if (!buffer) return { elapsedSec: 0, totalSec: 0, playing: false };
    const total = Math.max(0.05, buffer.duration);
    const pos = this.audioCtx ? Math.max(0, this.audioCtx.currentTime - this.recordingStartTime) : 0;
    const elapsed = total > 0 ? pos % total : pos;
    return { elapsedSec: elapsed, totalSec: total, playing: true };
  }

  /** Push samples into the waveform ring (chronological order). */
  private pushWaveform(chunk: Float32Array): void {
    const size = this.waveformRing.length;
    for (let i = 0; i < chunk.length; i++) {
      this.waveformRing[this.waveformRingHead] = chunk[i];
      this.waveformRingHead = (this.waveformRingHead + 1) % size;
      this.waveformRingSize = Math.min(size, this.waveformRingSize + 1);
    }
  }
}
