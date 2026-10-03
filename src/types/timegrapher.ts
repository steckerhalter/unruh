/**
 * Unruh - Mechanical Watch Timegrapher & Regulator Types
 */

export type BphOption = 18000 | 19800 | 21600 | 25200 | 28800 | 36000;

export interface BphPreset {
  bph: BphOption;
  label: string;
  hz: number;
  periodMs: number;
  commonMovements: string;
}

export const COMMON_BPH_PRESETS: BphPreset[] = [
  { bph: 18000, label: '18,000 bph (2.5 Hz)', hz: 2.5, periodMs: 200, commonMovements: 'Vintage pocket watches, Unitas 6497' },
  { bph: 19800, label: '19,800 bph (2.75 Hz)', hz: 2.75, periodMs: 181.82, commonMovements: 'Vintage Japanese/Russian, Raketa' },
  { bph: 21600, label: '21,600 bph (3.0 Hz)', hz: 3.0, periodMs: 166.67, commonMovements: 'Seiko NH35/4R/7S, Miyota 8215, Orient' },
  { bph: 25200, label: '25,200 bph (3.5 Hz)', hz: 3.5, periodMs: 142.86, commonMovements: 'Omega Co-Axial Cal. 2500/8500' },
  { bph: 28800, label: '28,800 bph (4.0 Hz)', hz: 4.0, periodMs: 125, commonMovements: 'ETA 2824-2, Sellita SW200, Rolex 3135, Miyota 9015' },
  { bph: 36000, label: '36,000 bph (5.0 Hz)', hz: 5.0, periodMs: 100, commonMovements: 'Zenith El Primero, Grand Seiko Hi-Beat' },
];

export interface BeatMeasurement {
  id: number;
  timestamp: number;
  measuredPeriodMs: number;
  targetPeriodMs: number;
  rateErrorSecondsPerDay: number; // e.g. +14.2 s/d or -8.5 s/d
  beatErrorMs: number; // e.g. 0.2 ms
  amplitudeDeg: number; // e.g. 285°
  isTick: boolean; // Alternates tick / tock
  deltaTImpulseMs: number; // t3 - t1 duration
  waveformSnippet?: Float32Array; // Acoustic snippet of the escapement click
}

export type TimeWindowSec = 15 | 30 | 60 | 300 | 900 | 3600 | 14400;

export interface AudioSettings {
  deviceId: string;
  gainMultiplier: number; // 1 to 25 (piezo boost)
  highPassCutoff: number; // 200 to 2000 Hz (cuts table rumble and mains hum)
  bandPassFreq: number; // 2000 to 7000 Hz (pallet jewel resonance)
  sensitivityThreshold: number; // 0.02 to 0.8
  autoThreshold: boolean;
  lockoutRatio: number; // 0.5 to 0.75 of expected beat period
  noiseGate: number; // minimum level
}

export interface WatchConfig {
  bphMode: 'auto' | BphOption | 'custom';
  customBph: number;
  effectiveBph: number;
  liftAngle: number; // Typically 52° (48°-56°)
  targetRate: number; // Usually 0.0 s/d
}

export interface SimulatorConfig {
  enabled: boolean;
  bph: BphOption;
  rateError: number; // -150 to +150 s/d
  beatError: number; // 0.0 to 4.0 ms
  amplitude: number; // 180 to 330 deg
  noiseLevel: number; // 0 to 0.5
  presetName: string;
}

export type ViewTab = 'oscilloscope' | 'split' | 'classic' | 'escapement' | 'positions' | 'fingerprints';

export type WatchPositionCode = 'CH' | 'CD' | '6H' | '9H' | '3H' | '12H';

export interface WatchPositionRecord {
  code: WatchPositionCode;
  label: string;
  avgRate: number;
  avgAmplitude: number;
  avgBeatError: number;
  samplesCount: number;
  timestamp: number;
}

export interface AcousticSignature {
  bph: number;
  peakResonanceHz: number;
  deltaTImpulseMs: number;
  spectralBands: number[]; // 8-band normalized energy profile
  tickTockRatio: number;
}

export interface WatchAcousticProfile {
  id: string;
  name: string;
  movementCalibre?: string;
  bph: BphOption;
  liftAngle: number;
  targetRate: number;
  signature: AcousticSignature;
  dateCreated: number;
  timesRecognized: number;
  notes?: string;
}

export interface FingerprintMatch {
  matchedProfile: WatchAcousticProfile | null;
  confidencePct: number;
  isUnknown: boolean;
  temporarySignatureId: string;
  currentSignature: AcousticSignature;
}
