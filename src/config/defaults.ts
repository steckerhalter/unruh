import {
  AudioSettings,
  WatchConfig,
  SimulatorConfig,
  TimeWindowSec,
} from '../types/timegrapher';

/**
 * Unruh — Central Application Defaults
 * Single source of truth for all configurations and default state.
 */

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({
  deviceId: 'default',
  gainMultiplier: 3000,
  highPassCutoff: 750,
  bandPassFreq: 4500,
  sensitivityThreshold: 0.12,
  autoThreshold: true,
  lockoutRatio: 0.65,
  noiseGate: 0.02,
  warmUpDelay: 5,
});

export const DEFAULT_WATCH_CONFIG: Readonly<WatchConfig> = Object.freeze({
  bphMode: 'auto',
  customBph: 21600,
  effectiveBph: 21600,
  liftAngle: 52,
  targetRate: 0.0,
});

export const DEFAULT_SIMULATOR_CONFIG: Readonly<SimulatorConfig> = Object.freeze({
  enabled: false,
  bph: 21600,
  rateSecondsPerDay: 0,
  beatError: 0.2,
  rateError: 0,
  amplitudeDeg: 280,
  noiseLevel: 0.05,
  presetName: 'ETA 2824-2 (Healthy)',
});

export const DEFAULT_TIME_WINDOW: TimeWindowSec = 60; // 1m window

export const APP_DEFAULTS = Object.freeze({
  audio: DEFAULT_AUDIO_SETTINGS,
  watch: DEFAULT_WATCH_CONFIG,
  simulator: DEFAULT_SIMULATOR_CONFIG,
  timeWindow: DEFAULT_TIME_WINDOW,
});
