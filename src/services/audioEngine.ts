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
  private highPassNode: BiquadFilterNode | null = null;
  private bandPassNode: BiquadFilterNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;

  // Simulator oscillator / nodes
  private simIntervalId: number | null = null;
  private simTargetNode: GainNode | null = null;

  private isRunning: boolean = false;
  private isSimulating: boolean = false;

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
    const minLockoutMs = Math.max(125, targetPeriodMs * 0.62);
    this.lockoutSamples = Math.floor((minLockoutMs / 1000) * sampleRate);
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

      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.highPassNode);
      this.highPassNode.connect(this.bandPassNode);
      this.bandPassNode.connect(this.analyserNode);
      this.bandPassNode.connect(this.processorNode);

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

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

    this.highPassNode = this.audioCtx.createBiquadFilter();
    this.highPassNode.type = 'highpass';
    this.highPassNode.frequency.setValueAtTime(400, this.audioCtx.currentTime);

    this.analyserNode = this.audioCtx.createAnalyser();
    this.analyserNode.fftSize = 1024;

    this.processorNode = this.audioCtx.createScriptProcessor(2048, 1, 1);
    this.processorNode.onaudioprocess = (e) => this.processAudioBuffer(e);

    this.simTargetNode = this.audioCtx.createGain();
    this.simTargetNode.connect(this.gainNode);
    this.gainNode.connect(this.highPassNode);
    this.highPassNode.connect(this.analyserNode);
    this.highPassNode.connect(this.processorNode);

    const muteGain = this.audioCtx.createGain();
    muteGain.gain.setValueAtTime(0.001, this.audioCtx.currentTime);
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
    const arg = Math.sin((liftAngle * Math.PI) / 180) / Math.sin((clampedAmp * Math.PI) / 180);
    const deltaTSeconds = Math.max(
      0.004,
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

    this.backgroundNoiseLevel = this.backgroundNoiseLevel * 0.95 + rms * 0.05;

    let threshold = this.audioSettings.sensitivityThreshold;
    if (this.audioSettings.autoThreshold) {
      threshold = Math.max(this.audioSettings.noiseGate, this.backgroundNoiseLevel * 3.5);
      this.adaptiveThreshold = threshold;
    }

    const env = new Float32Array(len);
    for (let i = 2; i < len - 2; i++) {
      env[i] =
        (Math.abs(inputBuffer[i - 2]) +
          Math.abs(inputBuffer[i - 1]) +
          Math.abs(inputBuffer[i]) +
          Math.abs(inputBuffer[i + 1]) +
          Math.abs(inputBuffer[i + 2])) / 5;
    }

    const chunkStartGlobalSample = this.totalProcessedSamples;

    for (let i = 4; i < len - 4; i++) {
      const val = env[i];

      if (
        val > threshold &&
          val >= env[i - 1] &&
          val >= env[i - 2] &&
          val > env[i + 1] &&
          val > env[i + 2] &&
          val > env[i - 4] * 1.6
      ) {
        const absoluteSampleIndex = chunkStartGlobalSample + i;
        const samplesSinceLast = absoluteSampleIndex - this.lastBeatSampleTime;

        if (samplesSinceLast >= this.lockoutSamples) {
          this.handleDetectedBeatFromRing(absoluteSampleIndex, sampleRate);
          this.lastBeatSampleTime = absoluteSampleIndex;
          break;
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

    // 2. Scan backward to locate T1 leading edge onset
    const t1Threshold = Math.max(peakAmp * 0.25, this.backgroundNoiseLevel * 2.5);
    let trueT1Idx = peakIdx;
    const maxBackScan = Math.floor(0.010 * sampleRate);

    for (let k = 0; k < maxBackScan; k++) {
      const idx = (peakIdx - k + this.RING_SIZE) % this.RING_SIZE;
      if (Math.abs(this.ringBuffer[idx]) <= t1Threshold) {
        trueT1Idx = idx;
        break;
      }
    }

    // 3. Extract snippet anchored with exactly 2ms pre-roll before T1
    const snippetSamples = Math.floor(0.045 * sampleRate);
    const preRollSamples = Math.floor(0.002 * sampleRate);
    const startRingIdx = (trueT1Idx - preRollSamples + this.RING_SIZE) % this.RING_SIZE;

    const snippet = new Float32Array(snippetSamples);
    for (let j = 0; j < snippetSamples; j++) {
      const rIdx = (startRingIdx + j) % this.RING_SIZE;
      snippet[j] = this.ringBuffer[rIdx];
    }

    const targetPeriodMs = 3600000 / this.watchConfig.effectiveBph;

    let currentHalfPeriodMs = targetPeriodMs;
    if (this.lastBeatSampleTime > 0) {
      const deltaSamples = globalTriggerSample - this.lastBeatSampleTime;
      currentHalfPeriodMs = (deltaSamples / sampleRate) * 1000;

      if (
        currentHalfPeriodMs > targetPeriodMs * 1.50 ||
          currentHalfPeriodMs < targetPeriodMs * 0.50
      ) {
        this.previousHalfPeriodMs = 0;
        return;
      }
    }

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
      const boundedBeatError = Math.min(9.9, Math.max(0, rawBeatError));

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
      const boundedRate = Math.max(-400, Math.min(400, rawCycleRate));

      this.recentCycleRates.push(boundedRate);
      if (this.recentCycleRates.length > this.integrationWindowBeats) {
        this.recentCycleRates.shift();
      }

      if (this.recentCycleRates.length >= 3) {
        const sorted = [...this.recentCycleRates].sort((a, b) => a - b);
        const toDrop = sorted.length >= 5 ? 1 : 0;
        const valid = sorted.slice(toDrop, sorted.length - toDrop);
        const sum = valid.reduce((a, b) => a + b, 0);
        rateErrorSecondsPerDay = sum / valid.length;
      } else {
        rateErrorSecondsPerDay = boundedRate;
      }
    } else {
      rateErrorSecondsPerDay = ((targetPeriodMs - currentHalfPeriodMs) / targetPeriodMs) * 86400;
      beatErrorMs = 0.0;
    }

    this.previousHalfPeriodMs = currentHalfPeriodMs;
    this.isTickTurn = !this.isTickTurn;

    const { deltaTMs, amplitude, t1Ms, t2Ms, t3Ms } = this.analyzeEscapementImpulses(
      snippet,
      sampleRate,
      targetPeriodMs,
      this.watchConfig.liftAngle
    );

    // Debugging verification outputs
    if (this.audioSettings.debug === true) {
      console.log(
        `[AudioEngine Beat #${this.beatCounter}] T1: ${t1Ms.toFixed(2)}ms | T2: ${t2Ms.toFixed(2)}ms | T3: ${t3Ms.toFixed(2)}ms | Δt: ${deltaTMs.toFixed(2)}ms | Amp: ${amplitude}°`
      );
      this.debugInspectSnippet(snippet, sampleRate, t1Ms, t2Ms, t3Ms);
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
      waveformSnippet: snippet,
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
  }

  private analyzeEscapementImpulses(
    snippet: Float32Array,
    sampleRate: number,
    targetPeriodMs: number,
    liftAngle: number
  ): { deltaTMs: number; amplitude: number; t1Ms: number; t2Ms: number; t3Ms: number } {
    const len = snippet.length;

    // 1. Calculate smoothed envelope
    const envelope = new Float32Array(len);
    const win = 3;
    for (let i = win; i < len - win; i++) {
      let sum = 0;
      for (let k = -win; k <= win; k++) {
        sum += Math.abs(snippet[i + k]);
      }
      envelope[i] = sum / (2 * win + 1);
    }

    // 2. Fixed T1 relative to pre-roll anchor (2ms pre-roll)
    const preRollSamples = Math.floor(0.002 * sampleRate);
    const t1Sample = preRollSamples; // T1 is exact anchor at 2.0ms

    // 3. Locate T2 (Impulse end / drop phase start)
    const t2SearchStart = t1Sample + Math.floor(0.0025 * sampleRate);
    const t2SearchEnd = t1Sample + Math.floor(0.0075 * sampleRate);
    let t2PeakIdx = t2SearchStart;
    let t2MaxVal = 0;

    for (let i = t2SearchStart; i <= t2SearchEnd; i++) {
      if (envelope[i] > t2MaxVal) {
        t2MaxVal = envelope[i];
        t2PeakIdx = i;
      }
    }
    const t2Sample = t2PeakIdx;

    // 4. Locate T3 (Banking impact onset)
    const t3SearchStart = t1Sample + Math.floor(0.0050 * sampleRate);
    const t3SearchEnd = Math.min(len - 1, t1Sample + Math.floor(0.0160 * sampleRate));

    let t3PeakIdx = t3SearchStart;
    let t3MaxVal = 0;
    for (let i = t3SearchStart; i <= t3SearchEnd; i++) {
      if (envelope[i] > t3MaxVal) {
        t3MaxVal = envelope[i];
        t3PeakIdx = i;
      }
    }

    // Back-scan from T3 peak to isolate exact leading edge onset of T3
    const t3Threshold = t3MaxVal * 0.20;
    let t3Sample = t3PeakIdx;
    for (let i = t3PeakIdx; i > t3SearchStart; i--) {
      if (envelope[i] <= t3Threshold) {
        t3Sample = i;
        break;
      }
    }

    // 5. Convert indices to time offsets (ms)
    const t1Ms = (t1Sample / sampleRate) * 1000;
    const t2Ms = (t2Sample / sampleRate) * 1000;
    const t3Ms = (t3Sample / sampleRate) * 1000;

    let deltaTMs = t3Ms - t1Ms;
    deltaTMs = Math.max(3.0, Math.min(16.0, deltaTMs));

    // 6. Amplitude Calculation
    const liftAngleRad = (liftAngle * Math.PI) / 180;
    const omegaT = (Math.PI * deltaTMs) / targetPeriodMs;
    const sinVal = Math.sin(omegaT);

    let amplitude = 260;
    if (sinVal > 0.01) {
      const ampRad = liftAngleRad / (2 * sinVal);
      amplitude = Math.round((ampRad * 180) / Math.PI);
      amplitude = Math.max(120, Math.min(350, amplitude));
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

  private checkAutoBph() {
    const sorted = [...this.recentIntervalsMs].sort((a, b) => a - b);
    const medianMs = sorted[Math.floor(sorted.length / 2)];

    let closestPreset = COMMON_BPH_PRESETS[2];
    let minDiff = 9999;

    for (const preset of COMMON_BPH_PRESETS) {
      const diff = Math.abs(preset.periodMs - medianMs);
      if (diff < minDiff) {
        minDiff = diff;
        closestPreset = preset;
      }
    }

    if (minDiff < closestPreset.periodMs * 0.15) {
      if (this.watchConfig.effectiveBph !== closestPreset.bph) {
        this.watchConfig.effectiveBph = closestPreset.bph;
        if (this.audioCtx) {
          this.updateLockoutSamples(this.audioCtx.sampleRate);
        }
        if (this.onAutoBphDetected) {
          this.onAutoBphDetected(closestPreset.bph);
        }
      }
    }
  }

  public stop() {
    this.isRunning = false;
    this.isSimulating = false;

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
    this.lastBeatSampleTime = 0;
    this.previousHalfPeriodMs = 0;
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
}
