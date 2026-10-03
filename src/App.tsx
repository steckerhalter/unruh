/**
 * Unruh - Mechanical Watch Timegrapher & Regulator
 * Precision acoustic watch timing analyzer, rate regulator oscilloscope,
 * BPH auto-detection, amplitude & beat error measurement.
 * Unified 2/3 + 1/3 at-a-glance layout with creamy Swiss horological bench aesthetic
 * and warm yellow/brown/khaki contrast palette.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  BphOption,
  COMMON_BPH_PRESETS,
  BeatMeasurement,
  FingerprintMatch,
  TimeWindowSec,
  AudioSettings,
  WatchAcousticProfile,
  WatchConfig,
  SimulatorConfig,
  ViewTab,
  DEFAULT_WATCH_CONFIG,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_SIMULATOR_CONFIG,
} from './types/timegrapher';
import { AudioEngine } from './services/audioEngine';
import { globalWatchFingerprinter } from './services/watchFingerprintEngine';
import { OscilloscopeRateTrend } from './components/OscilloscopeRateTrend';
import { EscapementOscilloscope } from './components/EscapementOscilloscope';
import { MovementSimulatorPanel } from './components/MovementSimulatorPanel';
import { PositionTester } from './components/PositionTester';
import { WatchIdentificationCard } from './components/WatchIdentificationCard';
import { AudioSettingsModal } from './components/AudioSettingsModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';

import {
  Mic,
  Sparkles,
  Sliders,
  Clock,
  Filter,
  Fingerprint,
} from 'lucide-react';

export default function App() {
  const engineRef = useRef<AudioEngine | null>(null);

  // Connection and Mode States: Idle by default (if mic not active, do nothing)
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ViewTab>('oscilloscope');
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // Acoustic Watch Identification
  const [fingerprintMatch, setFingerprintMatch] = useState<FingerprintMatch | null>(null);

  // Integration / Stabilization window (like physical Witschi/Weishi timegraphers)
  const [integrationSec, setIntegrationSec] = useState<number>(12);

  // Settings
  const [watchConfig, setWatchConfig] = useState<WatchConfig>(DEFAULT_WATCH_CONFIG);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);

  // Simulator Configuration
  const [simConfig, setSimConfig] = useState<SimulatorConfig>(DEFAULT_SIMULATOR_CONFIG);

  // Time Window: 1m (60s) default as requested by user
  const [timeWindow, setTimeWindow] = useState<TimeWindowSec>(60);

  // Telemetry Measurement Buffer
  const [measurements, setMeasurements] = useState<BeatMeasurement[]>([]);
  const [latestBeat, setLatestBeat] = useState<BeatMeasurement | null>(null);

  // Live Audio Meters
  const [currentRms, setCurrentRms] = useState<number>(0);
  const [currentPeak, setCurrentPeak] = useState<number>(0);
  const [adaptiveThreshold, setAdaptiveThreshold] = useState<number>(0.15);
  const [beatFlash, setBeatFlash] = useState<boolean>(false);

  // Modal states
  const [isAudioModalOpen, setIsAudioModalOpen] = useState<boolean>(false);

  // Initialize Audio Engine once
  useEffect(() => {
    const engine = new AudioEngine();
    engineRef.current = engine;

    engine.onBeat = (beat) => {
      setLatestBeat(beat);
      setBeatFlash(true);
      setTimeout(() => setBeatFlash(false), 90);

      setMeasurements((prev) => {
        const updated = [...prev, beat];
        if (updated.length > 2500) {
          return updated.slice(updated.length - 2500);
        }
        return updated;
      });
    };

    engine.onLevel = (rms, peak) => {
      setCurrentRms(rms);
      setCurrentPeak(peak);
      setAdaptiveThreshold(engine.getAdaptiveThreshold());
    };

    engine.onAutoBphDetected = (detected) => {
      setWatchConfig((prev) => ({ ...prev, effectiveBph: detected }));
    };

    engine.onAcousticSignature = (sig) => {
      const match = globalWatchFingerprinter.matchSignature(sig);
      setFingerprintMatch(match);
    };

    return () => {
      engine.stop();
    };
  }, []);

  const handleApplyProfile = (profile: WatchAcousticProfile) => {
    setWatchConfig((prev) => ({
      ...prev,
      effectiveBph: profile.bph,
      liftAngle: profile.liftAngle,
    }));
    if (isSimulating) {
      setSimConfig((prev) => ({
        ...prev,
        bph: profile.bph,
        presetName: profile.name,
      }));
    }
  };

  // Update integration window on engine
  useEffect(() => {
    if (engineRef.current) {
      const beats = Math.round(integrationSec * (watchConfig.effectiveBph / 3600));
      engineRef.current.setIntegrationWindow(beats);
    }
  }, [integrationSec, watchConfig.effectiveBph]);

  // Update watch config on engine
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateWatchConfig(watchConfig);
    }
  }, [watchConfig]);

  // Toggle Live Microphone input
  const handleToggleMicrophone = async () => {
    if (!engineRef.current) return;

    if (!isSimulating && isRunning) {
      engineRef.current.stop();
      setIsRunning(false);
    } else {
      if (isSimulating) {
        engineRef.current.stop();
        setIsSimulating(false);
      }
      const success = await engineRef.current.startMicrophone(audioSettings.deviceId);
      if (success) {
        setIsRunning(true);
      } else {
        alert('Could not access audio input. Please grant microphone permissions in your browser or Android settings.');
      }
    }
  };

  // Toggle Simulator Mode
  const handleToggleSimulator = () => {
    if (!engineRef.current) return;

    if (isSimulating && isRunning) {
      engineRef.current.stop();
      setIsRunning(false);
      setIsSimulating(false);
    } else {
      engineRef.current.startSimulation(
        simConfig.bph,
        simConfig.rateError,
        simConfig.beatError,
        simConfig.amplitude,
        simConfig.noiseLevel
      );
      setIsRunning(true);
      setIsSimulating(true);
    }
  };

  const handleSimConfigChange = (newConfig: SimulatorConfig) => {
    setSimConfig(newConfig);
    if (isSimulating && engineRef.current) {
      engineRef.current.updateSimulationParams(
        newConfig.rateError,
        newConfig.beatError,
        newConfig.amplitude,
        newConfig.noiseLevel
      );
    }
  };

  const handleApplySimPreset = (preset: {
    name: string;
    bph: BphOption;
    rate: number;
    beatError: number;
    amplitude: number;
    noise: number;
  }) => {
    const updated = {
      ...simConfig,
      presetName: preset.name,
      bph: preset.bph,
      rateError: preset.rate,
      beatError: preset.beatError,
      amplitude: preset.amplitude,
      noiseLevel: preset.noise,
    };
    setSimConfig(updated);
    setWatchConfig((prev) => ({ ...prev, effectiveBph: preset.bph }));
    if (isSimulating && engineRef.current) {
      engineRef.current.startSimulation(
        preset.bph,
        preset.rate,
        preset.beatError,
        preset.amplitude,
        preset.noise
      );
    }
  };

  const handleSaveAudioSettings = (newSettings: AudioSettings) => {
    setAudioSettings(newSettings);
    if (engineRef.current) {
      engineRef.current.updateAudioSettings(newSettings);
      if (!isSimulating && isRunning) {
        engineRef.current.startMicrophone(newSettings.deviceId);
      }
    }
  };

  const handleClearHistory = () => {
    setMeasurements([]);
  };

  // Compute stabilized rolling median for telemetry
  const recentBeats = useMemo(() => {
    const count = Math.max(4, Math.round(integrationSec * (watchConfig.effectiveBph / 3600)));
    return measurements.slice(-count);
  }, [measurements, integrationSec, watchConfig.effectiveBph]);

  // Compute smoothed rolling average for telemetry based on integrationSec
  const liveRateAvg = useMemo(() => {
    if (recentBeats.length === 0) return latestBeat ? latestBeat.rateErrorSecondsPerDay : 0;
    const sum = recentBeats.reduce((acc, b) => acc + b.rateErrorSecondsPerDay, 0);
    return sum / recentBeats.length; // True moving average
  }, [recentBeats, latestBeat]);

  const liveAmpAvg = useMemo(() => {
    if (recentBeats.length === 0) return latestBeat ? latestBeat.amplitudeDeg : 275;
    const sorted = [...recentBeats].map((b) => b.amplitudeDeg).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return Math.round(sorted[mid]);
  }, [recentBeats, latestBeat]);

  const liveBeatErrAvg = useMemo(() => {
    if (recentBeats.length === 0) return latestBeat ? latestBeat.beatErrorMs : 0.2;
    const sorted = [...recentBeats].map((b) => b.beatErrorMs).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted[mid];
  }, [recentBeats, latestBeat]);

  return (
    <div className="min-h-screen bg-[#f7f4ec] text-stone-900 flex flex-col font-sans selection:bg-[#d97706]/20 selection:text-[#78350f]">
      {/* Top Header Bar - Condensed to minimal vertical height */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-3 sm:px-5 py-2 bg-[#fdfcf9]/95 border-b border-[#ded5c5] backdrop-blur-md shadow-xs">
        {/* Left: Wordmark & Pulse */}
        <div className="flex items-center gap-2">
          <div
            className={`p-1.5 rounded-lg border transition-all ${
              beatFlash
                ? 'bg-[#b45309] border-[#b45309] text-white shadow-xs'
                : 'bg-[#faf7f0] border-[#ded5c5] text-[#78350f]'
            }`}
          >
            <Clock className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-base font-bold tracking-tight text-stone-900 font-display">
              Unruh
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#f5f0e4] text-[#78350f] border border-[#e5decb]">
              Timegrapher
            </span>
          </div>
        </div>

        {/* Center: Navigation views (Desktop) */}
        <nav className="hidden md:flex items-center gap-1 bg-[#f5f0e4] p-0.5 rounded-lg border border-[#ded5c5] text-xs font-mono">
          <button
            onClick={() => setActiveTab('oscilloscope')}
            className={`px-2.5 py-1 rounded-md font-medium transition ${
              activeTab === 'oscilloscope'
                ? 'bg-white text-[#78350f] shadow-xs border border-[#d6a95e]/60 font-bold'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Regulator Console
          </button>
          <button
            onClick={() => setActiveTab('escapement')}
            className={`px-2.5 py-1 rounded-md font-medium transition ${
              activeTab === 'escapement'
                ? 'bg-white text-[#78350f] shadow-xs border border-[#d6a95e]/60 font-bold'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Escapement Pulse
          </button>
          <button
            onClick={() => setActiveTab('positions')}
            className={`px-2.5 py-1 rounded-md font-medium transition ${
              activeTab === 'positions'
                ? 'bg-white text-[#78350f] shadow-xs border border-[#d6a95e]/60 font-bold'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            6-Pos Log
          </button>
          <button
            onClick={() => setActiveTab('fingerprints')}
            className={`px-2.5 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
              activeTab === 'fingerprints'
                ? 'bg-white text-[#78350f] shadow-xs border border-[#d6a95e]/60 font-bold'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Fingerprint className="w-3.5 h-3.5 text-[#92400e]" />
            Watch ID
          </button>
        </nav>

        {/* Right: Actions docked to the right */}
        <div className="flex items-center gap-1.5">
          {/* PWA Install */}
          <PWAInstallButton />

          {/* Piezo DSP Calibration Trigger */}
          <button
            onClick={() => setIsAudioModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded-lg bg-[#f5f0e4] hover:bg-white border border-[#ded5c5] text-stone-700 transition"
            title="Calibrate piezo sensor, highpass filter & trigger threshold"
          >
            <Sliders className="w-3.5 h-3.5 text-[#78350f]" />
            <span className="hidden sm:inline">Piezo DSP</span>
          </button>

          {/* Live Mic vs Simulator Toggle */}
          <div className="flex items-center gap-0.5 bg-[#f5f0e4] p-0.5 rounded-lg border border-[#ded5c5]">
            <button
              onClick={handleToggleMicrophone}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-medium transition ${
                !isSimulating && isRunning
                  ? 'bg-emerald-100 text-emerald-900 border border-emerald-300 shadow-xs font-bold'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
              title="Listen to physical watch with microphone / piezo sensor"
            >
              <Mic className="w-3.5 h-3.5 text-emerald-700" />
              <span>{!isSimulating && isRunning ? 'Mic Active' : 'Live Mic'}</span>
            </button>

            <button
              onClick={handleToggleSimulator}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-medium transition ${
                isSimulating && isRunning
                  ? 'bg-[#fef3c7] text-[#78350f] border border-[#fde68a] shadow-xs font-bold'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
              title="Synthesize virtual watch movement for instant testing"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#b45309]" />
              <span>Simulate</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Tab Navigation */}
      <div className="flex md:hidden items-center justify-around px-2 py-1.5 bg-[#fdfcf9] border-b border-[#ded5c5] text-[11px] font-mono overflow-x-auto">
        {(['oscilloscope', 'escapement', 'positions', 'fingerprints'] as ViewTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-2 py-0.5 rounded whitespace-nowrap ${
              activeTab === tab
                ? 'bg-[#fef3c7] text-[#78350f] font-bold border border-[#fde68a]'
                : 'text-stone-600'
            }`}
          >
            {
              {
                oscilloscope: 'Console',
                escapement: 'Escapement',
                positions: '6-Pos',
                fingerprints: 'Watch ID',
              }[tab] || 'Console'
            }
          </button>
        ))}
      </div>

      {/* Main App Body - Condensed padding and gap */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-2.5 sm:p-3.5 space-y-3">
        {/* ========================================================================= */}
        {/* 2/3 GRAPH ON LEFT + 1/3 NAME & NUMBERS ON RIGHT (AT-A-GLANCE BENCH LAYOUT) */}
        {/* ========================================================================= */}
        {activeTab === 'oscilloscope' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
            {/* Left Column: 2/3 of screen width (8 of 12 columns) for Graph & Visualizers */}
            <div className="lg:col-span-8 space-y-2.5">
              {/* Primary Oscilloscope Rate Trend Timeline with right-docked controls */}
              <OscilloscopeRateTrend
                measurements={measurements}
                integrationSec={integrationSec}
                bph={watchConfig.effectiveBph}
                targetRate={watchConfig.targetRate}
                timeWindow={timeWindow}
                onTimeWindowChange={setTimeWindow}
                onClearHistory={handleClearHistory}
                isPaused={isPaused}
                isRunning={isRunning}
              />

              {/* Movement Simulator Panel (condensed in height, controls docked right) */}
              {isSimulating && (
                <MovementSimulatorPanel
                  config={simConfig}
                  onChangeConfig={handleSimConfigChange}
                  onApplyPreset={handleApplySimPreset}
                />
              )}
            </div>

            {/* Right Column: 1/3 of screen width (4 of 12 columns) - Condensed in Height */}
            <div className="lg:col-span-4 space-y-2">
              {/* 1. Acoustic Watch Identification Ribbon */}
              <WatchIdentificationCard
                match={fingerprintMatch}
                onApplyProfile={handleApplyProfile}
                compact={true}
              />

              {/* 2. Primary Telemetry Metric Cards (Condensed Heights & Side-by-Side Grid) */}
              <div className="space-y-2">
                {/* Card 1: DAILY RATE DEVIATION - Condensed Height */}
                <div className="px-3.5 py-2.5 bg-white border border-[#ded5c5] rounded-xl shadow-xs relative overflow-hidden">
                  <div className="flex items-center justify-between text-[11px] text-stone-500 font-mono">
                    <span className="uppercase tracking-wider font-semibold">DAILY RATE</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-[#78350f] font-bold bg-[#fef3c7] px-1.5 py-0.5 rounded border border-[#fde68a]">
                        TARGET: 0.0 s/d
                      </span>
                    </div>
                  </div>

                  {/* Main Rate Value & Status Pill */}
                  <div className="py-1 flex items-baseline justify-between">
                    {isRunning || measurements.length > 0 ? (
                      <div
                        className={`text-3xl sm:text-4xl font-mono font-bold tracking-tight tabular-nums ${
                          Math.abs(liveRateAvg) <= 5
                            ? 'text-emerald-700'
                            : Math.abs(liveRateAvg) <= 15
                              ? 'text-[#92400e]'
                              : Math.abs(liveRateAvg) <= 30
                                ? 'text-amber-700'
                                : 'text-rose-700'
                        }`}
                      >
                        {liveRateAvg >= 0 ? '+' : ''}
                        {liveRateAvg.toFixed(1)}
                        <span className="text-sm font-normal text-stone-500 ml-1 font-sans">s/d</span>
                      </div>
                    ) : (
                      <div className="text-3xl sm:text-4xl font-mono font-bold tracking-tight text-stone-400">
                        ---<span className="text-sm font-normal text-stone-400 ml-1 font-sans">s/d</span>
                      </div>
                    )}

                    {/* Instant rate readout & delta indicator */}
                    <div className="text-right text-[11px] font-mono">
                      {isRunning || measurements.length > 0 ? (
                        <span
                          className={`font-semibold px-2 py-0.5 rounded text-[10px] inline-block ${
                            Math.abs(liveRateAvg) <= 5
                              ? 'bg-emerald-100 text-emerald-800'
                              : Math.abs(liveRateAvg) <= 15
                                ? 'bg-[#fef3c7] text-[#78350f] border border-[#fde68a]'
                                : Math.abs(liveRateAvg) <= 30
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {Math.abs(liveRateAvg) <= 5
                            ? '● Chronometer Grade'
                            : liveRateAvg > 0
                              ? '● Fast (+)'
                              : '● Slow (-)'}
                        </span>
                      ) : (
                        <span className="text-stone-400 text-[10px]">Awaiting Signal</span>
                      )}
                      {latestBeat && (
                        <div className="text-stone-500 text-[10px] mt-0.5">
                          Instant: <strong className="text-stone-800">{latestBeat.rateErrorSecondsPerDay >= 0 ? '+' : ''}{latestBeat.rateErrorSecondsPerDay.toFixed(1)}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Cards 2 & 3 Side-by-Side: AMPLITUDE & BEAT ERROR */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Amplitude */}
                  <div className="px-3 py-2 bg-white border border-[#ded5c5] rounded-xl shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between text-[10px] text-stone-500 font-mono">
                      <span className="uppercase tracking-wider font-semibold">AMPLITUDE</span>
                      <span className="text-stone-500">{watchConfig.liftAngle}°</span>
                    </div>

                    <div className="py-0.5">
                      {isRunning || measurements.length > 0 ? (
                        <div className="text-2xl sm:text-3xl font-mono font-bold tracking-tight text-stone-900 tabular-nums">
                          {liveAmpAvg}<span className="text-sm font-normal text-stone-500 ml-0.5">°</span>
                        </div>
                      ) : (
                        <div className="text-2xl sm:text-3xl font-mono font-bold tracking-tight text-stone-400">
                          ---<span className="text-sm font-normal text-stone-400 ml-0.5">°</span>
                        </div>
                      )}
                    </div>

                    <div className="text-[10px] font-mono pt-1 border-t border-[#eee5d5] truncate">
                      {isRunning || measurements.length > 0 ? (
                        <span
                          className={`font-semibold ${
                            liveAmpAvg >= 250 && liveAmpAvg <= 315
                              ? 'text-emerald-700'
                              : liveAmpAvg < 240
                                ? 'text-amber-700'
                                : 'text-rose-700'
                          }`}
                        >
                          {liveAmpAvg >= 250 && liveAmpAvg <= 315 ? '● Optimal' : liveAmpAvg < 240 ? '● Low' : '● Knocking'}
                        </span>
                      ) : (
                        <span className="text-stone-400">Standby</span>
                      )}
                    </div>
                  </div>

                  {/* Beat Error */}
                  <div className="px-3 py-2 bg-white border border-[#ded5c5] rounded-xl shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between text-[10px] text-stone-500 font-mono">
                      <span className="uppercase tracking-wider font-semibold">BEAT ERROR</span>
                      <span className="text-stone-500">TICK/TOCK</span>
                    </div>

                    <div className="py-0.5">
                      {isRunning || measurements.length > 0 ? (
                        <div
                          className={`text-2xl sm:text-3xl font-mono font-bold tracking-tight tabular-nums ${
                            liveBeatErrAvg <= 0.4 ? 'text-emerald-700' : liveBeatErrAvg <= 1.0 ? 'text-amber-700' : 'text-rose-700'
                          }`}
                        >
                          {liveBeatErrAvg.toFixed(1)}<span className="text-sm font-normal text-stone-500 ml-0.5">ms</span>
                        </div>
                      ) : (
                        <div className="text-2xl sm:text-3xl font-mono font-bold tracking-tight text-stone-400">
                          ---<span className="text-sm font-normal text-stone-400 ml-0.5">ms</span>
                        </div>
                      )}
                    </div>

                    <div className="text-[10px] font-mono pt-1 border-t border-[#eee5d5] truncate">
                      {isRunning || measurements.length > 0 ? (
                        <span
                          className={`font-semibold ${
                            liveBeatErrAvg <= 0.4 ? 'text-emerald-700' : liveBeatErrAvg <= 1.0 ? 'text-amber-700' : 'text-rose-700'
                          }`}
                        >
                          {liveBeatErrAvg <= 0.4 ? '● Centered' : '● Adjust Stud'}
                        </span>
                      ) : (
                        <span className="text-stone-400">Standby</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card 4: FREQUENCY, LIFT ANGLE & FILTER SPEC - Compact & Low Profile */}
                <div className="px-3.5 py-2.5 bg-white border border-[#ded5c5] rounded-xl shadow-xs space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-stone-500 font-mono">
                    <span className="uppercase tracking-wider font-semibold">CALIBRATION & FILTER</span>
                    <span className="text-[10px] text-[#78350f] font-mono uppercase font-bold">
                      {watchConfig.bphMode === 'auto' ? 'Auto-Lock' : 'Manual'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-stone-500 font-mono uppercase block">BPH Rate:</label>
                      <select
                        value={watchConfig.bphMode === 'auto' ? 'auto' : watchConfig.effectiveBph}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'auto') {
                            setWatchConfig({ ...watchConfig, bphMode: 'auto' });
                          } else {
                            const bphNum = parseInt(val, 10) as BphOption;
                            setWatchConfig({
                              ...watchConfig,
                              bphMode: bphNum,
                              effectiveBph: bphNum,
                            });
                          }
                        }}
                        className="w-full bg-[#fdfcf9] text-stone-900 border border-[#ded5c5] rounded px-1.5 py-1 text-xs font-mono focus:outline-none focus:border-[#78350f]"
                      >
                        <option value="auto">Auto ({watchConfig.effectiveBph})</option>
                        {COMMON_BPH_PRESETS.map((p) => (
                          <option key={p.bph} value={p.bph}>
                            {p.bph.toLocaleString()} ({p.hz} Hz)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[9px] text-stone-500 font-mono uppercase block">Lift Angle:</label>
                      <div className="flex items-center justify-between bg-[#fdfcf9] border border-[#ded5c5] rounded px-2 py-0.5 text-xs font-mono">
                        <span className="font-bold text-stone-900">{watchConfig.liftAngle}°</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() =>
                              setWatchConfig({ ...watchConfig, liftAngle: Math.max(40, watchConfig.liftAngle - 1) })
                            }
                            className="w-4 h-4 bg-white border border-[#ded5c5] text-stone-700 hover:text-stone-900 rounded flex items-center justify-center font-bold text-xs"
                          >
                            -
                          </button>
                          <button
                            onClick={() =>
                              setWatchConfig({ ...watchConfig, liftAngle: Math.min(65, watchConfig.liftAngle + 1) })
                            }
                            className="w-4 h-4 bg-white border border-[#ded5c5] text-stone-700 hover:text-stone-900 rounded flex items-center justify-center font-bold text-xs"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Stabilization Filter Period */}
                  <div className="flex items-center justify-start gap-2 pt-1.5 border-t border-[#eee5d5] text-[10px] font-mono text-stone-600">
                    <span className="flex items-center gap-1">
                      <Filter className="w-3 h-3 text-[#78350f]" />
                      Filter Window:
                    </span>
                    <div className="flex items-center gap-1">
                      {[2, 12, 30].map((sec) => (
                        <button
                          key={sec}
                          onClick={() => setIntegrationSec(sec)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition ${
                            integrationSec === sec
                              ? 'bg-[#78350f] text-white font-bold'
                              : 'bg-[#f5f0e4] border border-[#ded5c5] text-stone-700 hover:text-stone-900'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Other Tabs: Escapement Pulse, 6-Position Log, Watch ID */
          <div className="space-y-3">
            {activeTab === 'escapement' && (
              <EscapementOscilloscope latestBeat={latestBeat} liftAngle={watchConfig.liftAngle} />
            )}

            {activeTab === 'positions' && (
              <PositionTester latestBeat={latestBeat} recentMeasurements={measurements} />
            )}

            {activeTab === 'fingerprints' && (
              <WatchIdentificationCard match={fingerprintMatch} onApplyProfile={handleApplyProfile} />
            )}
          </div>
        )}
      </main>

      {/* Audio DSP Calibration Modal */}
      <AudioSettingsModal
        isOpen={isAudioModalOpen}
        onClose={() => setIsAudioModalOpen(false)}
        settings={audioSettings}
        onSaveSettings={handleSaveAudioSettings}
        currentRms={currentRms}
        currentPeak={currentPeak}
        adaptiveThreshold={adaptiveThreshold}
      />

      {/* Offline Status Banner */}
      <OfflineIndicator />
    </div>
  );
}
