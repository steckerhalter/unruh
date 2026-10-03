/**
 * Unruh Web Audio DSP Engine
 * Tailored specifically for piezo microphones & acoustic watch escapement detection.
 * Computes daily rate deviation on paired oscillation cycles (T_tick + T_tock) to eliminate
 * the beat error jump artifact, with sub-sample peak interpolation and integration filtering.
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

  // ---------------------------------------------------------------------------
  // 1. USE CENTRAL DEFAULTS AS INITIAL STATE
  // ---------------------------------------------------------------------------
  private audioSettings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private watchConfig: WatchConfig = { ...DEFAULT_WATCH_CONFIG };

  // DSP internal state
  private beatCounter: number = 0;
  private totalProcessedSamples: number = 0; // Monotonic sample accumulator
  private lastBeatSampleTime: number = 0;
  private previousHalfPeriodMs: number = 0;
  private isTickTurn: boolean = true;
  private lockoutSamples: number = 0;
  private adaptiveThreshold: number = 0.15;
  private backgroundNoiseLevel: number = 0.02;

  // Rolling rate smoothing buffer (paired cycle rates)
  private recentCycleRates: number[] = [];
  private integrationWindowBeats: number = 6; // ~1-2 seconds of beats for stable reading

  // Recent intervals for auto-BPH detection
  private recentIntervalsMs: number[] = [];

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
      this.gainNode.gain.setValueAtTime(this.audioSettings.gainMultiplier, this.audioCtx?.currentTime || 0);
    }
    if (this.highPassNode && newSettings.highPassCutoff !== undefined) {
      this.highPassNode.frequency.setValueAtTime(this.audioSettings.highPassCutoff, this.audioCtx?.currentTime || 0);
    }
    if (this.bandPassNode && newSettings.bandPassFreq !== undefined) {
      this.bandPassNode.frequency.setValueAtTime(this.audioSettings.bandPassFreq, this.audioCtx?.currentTime || 0);
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
    const lockoutMs = targetPeriodMs * this.audioSettings.lockoutRatio;
    this.lockoutSamples = Math.floor((lockoutMs / 1000) * sampleRate);
  }

  public async startMicrophone(deviceId?: string): Promise<boolean> {
    try {
      this.stop();

      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      const sampleRate = this.audioCtx.sampleRate;
      this.updateLockoutSamples(sampleRate);
      this.totalProcessedSamples = 0;
      this.lastBeatSampleTime = 0;

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

      // -----------------------------------------------------------------------
      // 2. EXPLICITLY INITIALIZE NODES WITH THE SINGLE SOURCE OF TRUTH
      // -----------------------------------------------------------------------
      const now = this.audioCtx.currentTime;

      // Gain Node
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.setValueAtTime(this.audioSettings.gainMultiplier, now);

      // High-Pass Node
      this.highPassNode = this.audioCtx.createBiquadFilter();
      this.highPassNode.type = 'highpass';
      this.highPassNode.frequency.setValueAtTime(this.audioSettings.highPassCutoff, now);
      this.highPassNode.Q.setValueAtTime(0.707, now);

      // Band-Pass Node
      this.bandPassNode = this.audioCtx.createBiquadFilter();
      this.bandPassNode.type = 'bandpass';
      this.bandPassNode.frequency.setValueAtTime(this.audioSettings.bandPassFreq, now);
      this.bandPassNode.Q.setValueAtTime(1.8, now);

      // Analyser Node
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 1024;
      this.analyserNode.smoothingTimeConstant = 0.2;

      // ScriptProcessor Node
      this.processorNode = this.audioCtx.createScriptProcessor(2048, 1, 1);
      this.processorNode.onaudioprocess = (e) => this.processAudioBuffer(e);

      // Connect DSP chain
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

  // ---------------------------------------------------------------------------
  // 3. ADD A RESET METHOD TO RESTORE CENTRAL DEFAULTS AT ANY TIME
  // ---------------------------------------------------------------------------
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

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioContextClass();

    this.watchConfig.effectiveBph = bph;
    const sampleRate = this.audioCtx.sampleRate;
    this.updateLockoutSamples(sampleRate);
    this.totalProcessedSamples = 0;
    this.lastBeatSampleTime = 0;

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
  private _simRate = 0;
  private _simBeatError = 0.2;
  private _simAmplitude = 280;
  private _simNoise = 0.05;

  private synthesizeEscapementPulse(amplitudeDeg: number, noiseLevel: number) {
    if (!this.audioCtx || !this.simTargetNode) return;
    const now = this.audioCtx.currentTime;

    const targetPeriodMs = 3600000 / this.watchConfig.effectiveBph;
    const liftAngle = this.watchConfig.liftAngle;
    const clampedAmp = Math.max(120, Math.min(340, amplitudeDeg));
    const arg = Math.sin((liftAngle * Math.PI) / 180) / Math.sin((clampedAmp * Math.PI) / 180);
    const deltaTSeconds = Math.max(0.004, Math.min(0.015, (targetPeriodMs / 1000 / Math.PI) * Math.asin(Math.min(0.99, arg))));

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
      const val = Math.abs(inputBuffer[i]);
      if (val > peak) peak = val;
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / len);

    if (this.onLevel) {
      this.onLevel(rms, peak);
    }

    this.backgroundNoiseLevel = this.backgroundNoiseLevel * 0.95 + rms * 0.05;

    let threshold = this.audioSettings.sensitivityThreshold;
    if (this.audioSettings.autoThreshold) {
      threshold = Math.max(this.audioSettings.noiseGate, this.backgroundNoiseLevel * 3.2);
      this.adaptiveThreshold = threshold;
    }

    const bufferStartSample = this.totalProcessedSamples;

    for (let i = 1; i < len - 1; i++) {
      const absVal = Math.abs(inputBuffer[i]);

      if (absVal > threshold && absVal >= Math.abs(inputBuffer[i - 1]) && absVal > Math.abs(inputBuffer[i + 1])) {
        const y0 = Math.abs(inputBuffer[i - 1]);
        const y1 = absVal;
        const y2 = Math.abs(inputBuffer[i + 1]);
        const denom = 2 * (y0 - 2 * y1 + y2);
        const delta = denom !== 0 ? (y0 - y2) / denom : 0;
        const subSampleOffset = Math.max(-0.5, Math.min(0.5, delta));

        const absoluteSampleIndex = bufferStartSample + i + subSampleOffset;
        const samplesSinceLast = absoluteSampleIndex - this.lastBeatSampleTime;

        if (samplesSinceLast >= this.lockoutSamples) {
          this.handleDetectedBeat(inputBuffer, i, sampleRate, absoluteSampleIndex);
          this.lastBeatSampleTime = absoluteSampleIndex;
          break;
        }
      }
    }

    this.totalProcessedSamples += len;
  }

  private handleDetectedBeat(
    buffer: Float32Array,
    peakIndexInBuffer: number,
    sampleRate: number,
    sampleTime: number
  ) {
    this.beatCounter++;
    const now = performance.now();

    const snippetSamples = Math.floor(0.03 * sampleRate);
    const snippet = new Float32Array(snippetSamples);
    const startIdx = Math.max(0, peakIndexInBuffer - Math.floor(0.003 * sampleRate));
    for (let j = 0; j < snippetSamples; j++) {
      if (startIdx + j < buffer.length) {
        snippet[j] = buffer[startIdx + j];
      }
    }

    const targetPeriodMs = 3600000 / this.watchConfig.effectiveBph;

    let currentHalfPeriodMs = targetPeriodMs;
    if (this.lastBeatSampleTime > 0) {
      const deltaSamples = sampleTime - this.lastBeatSampleTime;
      currentHalfPeriodMs = (deltaSamples / sampleRate) * 1000;

      if (currentHalfPeriodMs > targetPeriodMs * 1.65 || currentHalfPeriodMs < targetPeriodMs * 0.45) {
        this.previousHalfPeriodMs = 0;
        this.lastBeatSampleTime = sampleTime;
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
      beatErrorMs = Math.abs(currentHalfPeriodMs - this.previousHalfPeriodMs) / 2;
      beatErrorMs = Math.min(9.9, Math.max(0, beatErrorMs));

      const fullCyclePeriodMs = currentHalfPeriodMs + this.previousHalfPeriodMs;
      const targetCyclePeriodMs = targetPeriodMs * 2;

      const rawCycleRate = ((targetCyclePeriodMs - fullCyclePeriodMs) / targetCyclePeriodMs) * 86400;

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
    }

    this.previousHalfPeriodMs = currentHalfPeriodMs;
    this.isTickTurn = !this.isTickTurn;

    const { deltaTMs, amplitude } = this.analyzeEscapementImpulses(
      snippet,
      sampleRate,
      targetPeriodMs,
      this.watchConfig.liftAngle
    );

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
      waveformSnippet: snippet,
    };

    if (this.onBeat) {
      this.onBeat(measurement);
    }

    if (this.onAcousticSignature && this.beatCounter % 3 === 0) {
      const freqData = new Uint8Array(this.analyserNode ? this.analyserNode.frequencyBinCount : 64);
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
  ): { deltaTMs: number; amplitude: number } {
    let maxVal = 0;
    let maxIdx = 0;
    for (let i = 0; i < snippet.length; i++) {
      const val = Math.abs(snippet[i]);
      if (val > maxVal) {
        maxVal = val;
        maxIdx = i;
      }
    }

    let deltaTMs = 6.8;
    const t3Sample = maxIdx;
    const minImpulseDistance = Math.floor(0.0035 * sampleRate);
    const maxImpulseDistance = Math.floor(0.014 * sampleRate);

    let t1Sample = Math.max(0, t3Sample - minImpulseDistance);
    let earlyPeakVal = 0;
    for (let i = Math.max(0, t3Sample - maxImpulseDistance); i < t3Sample - minImpulseDistance; i++) {
      const val = Math.abs(snippet[i]);
      if (val > earlyPeakVal) {
        earlyPeakVal = val;
        t1Sample = i;
      }
    }

    if (earlyPeakVal > 0.15 * maxVal) {
      deltaTMs = ((t3Sample - t1Sample) / sampleRate) * 1000;
    }

    const angleRad = (Math.PI * deltaTMs) / targetPeriodMs;
    const sinVal = Math.sin(angleRad);
    let amplitude = 275;
    if (sinVal > 0.05) {
      amplitude = Math.round(liftAngle / sinVal);
      amplitude = Math.max(160, Math.min(335, amplitude));
    }

    return { deltaTMs, amplitude };
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
    this.recentCycleRates = [];
    this.lastBeatSampleTime = 0;
    this.previousHalfPeriodMs = 0;
  }

  public getIsRunning() {
    return this.isRunning;
  }

  public getIsSimulating() {
    return this.isSimulating;
  }

  public getAdaptiveThreshold() {
    return this.adaptiveThreshold;
  }
}
