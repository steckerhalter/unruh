/**
 * ChronoScope - Audio & Piezo Microphone Calibration Modal
 * Solves the signal detection challenges of piezo pickups that fail in software like TG.
 * Styled in warm creamy horological bench aesthetic with yellow/brown/khaki accents.
 */

import React, { useEffect, useState } from 'react';
import { AudioSettings } from '../types/timegrapher';
import { X, Mic, Sliders, Volume2, Sparkles } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: AudioSettings;
  onSaveSettings: (settings: AudioSettings) => void;
  currentRms: number;
  currentPeak: number;
  adaptiveThreshold: number;
}

export const AudioSettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  currentRms,
  currentPeak,
  adaptiveThreshold,
}) => {
  const [localSettings, setLocalSettings] = useState<AudioSettings>(settings);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (isOpen) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const audioInputs = devices.filter((d) => d.kind === 'audioinput');
        setAudioDevices(audioInputs);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveSettings(localSettings);
    onClose();
  };

  // Convert linear peak to percentage for VU meter
  const peakPct = Math.min(100, Math.round(currentPeak * 100));
  const threshPct = Math.min(
    100,
    Math.round((localSettings.autoThreshold ? adaptiveThreshold : localSettings.sensitivityThreshold) * 100)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-fadeIn">
      <div className="w-full max-w-xl bg-white border border-[#ded5c5] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#ded5c5] bg-[#faf7f0]">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-4 h-4 text-[#78350f]" />
            <div>
              <h2 className="font-semibold text-stone-900 font-display text-sm">
                Acoustic & Piezo Pickup Calibration
              </h2>
              <p className="text-[11px] text-stone-500 font-mono">
                DSP filtering and trigger sensitivity for mechanical watch escapements
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-[#f5f0e4] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
          {/* Live Signal Level & Trigger VU Meter */}
          <div className="p-3 bg-[#faf7f0] rounded-xl border border-[#ded5c5] space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-stone-600 flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-[#78350f]" /> Live Signal Peak:
              </span>
              <span className="text-stone-800">
                Peak: <strong className="text-[#92400e]">{peakPct}%</strong> · Trigger at:{' '}
                <strong className="text-amber-800">{threshPct}%</strong>
              </span>
            </div>

            {/* Visual VU Meter Bar */}
            <div className="relative w-full h-4 bg-[#eee8db] rounded-md overflow-hidden border border-[#ded5c5]">
              {/* Peak fill */}
              <div
                className={`h-full transition-all duration-75 ${
                  peakPct >= threshPct ? 'bg-gradient-to-r from-[#b45309] to-emerald-600' : 'bg-stone-400'
                }`}
                style={{ width: `${peakPct}%` }}
              />

              {/* Threshold line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-amber-600 shadow-xs z-10"
                style={{ left: `${threshPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-stone-500">
              <span>0% Silence</span>
              <span className="text-amber-800 font-semibold">▲ Trigger Threshold</span>
              <span>100% Clip</span>
            </div>
          </div>

          {/* Audio Input Device */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-stone-800 flex items-center gap-1.5 font-mono">
              <Mic className="w-3.5 h-3.5 text-[#78350f]" />
              MICROPHONE / PIEZO AUDIO INTERFACE
            </label>
            <select
              value={localSettings.deviceId}
              onChange={(e) => setLocalSettings({ ...localSettings, deviceId: e.target.value })}
              className="w-full bg-[#fdfcf9] border border-[#d6ccbb] rounded-lg px-2.5 py-1.5 text-xs text-stone-900 font-mono focus:outline-none focus:border-[#78350f]"
            >
              <option value="default">System Default Input</option>
              {audioDevices.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label || `Audio Input (${dev.deviceId.slice(0, 8)}...)`}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-stone-500 font-mono">
              For best watchmaking accuracy, connect a piezo clip microphone or high-gain preamp.
            </p>
          </div>

          {/* Piezo Boost & Gain Multiplier */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-stone-700 font-semibold">Piezo Pre-Amp Boost:</span>
            </div>
            <input
              type="range"
              min="1"
              max="5000"
              step="100"
              value={localSettings.gainMultiplier}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, gainMultiplier: parseInt(e.target.value, 10) })
              }
              className="w-full accent-[#b45309] cursor-pointer"
            />
            <div className="flex justify-between text-[10px] font-mono text-stone-400">
              <span>Min</span>
              <span>Max</span>
            </div>
          </div>

          {/* Escapement Bandpass Filter */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-stone-700 font-semibold">Escapement Pallet Strike Filter:</span>
              <span className="text-[#92400e] font-bold">{localSettings.bandPassFreq} Hz</span>
            </div>
            <input
              type="range"
              min="2000"
              max="7000"
              step="250"
              value={localSettings.bandPassFreq}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, bandPassFreq: parseInt(e.target.value, 10) })
              }
              className="w-full accent-[#b45309] cursor-pointer"
            />
            <div className="flex justify-between text-[10px] font-mono text-stone-400">
              <span>2,000 Hz</span>
              <span>4,500 Hz (Pallet Jewel Impact)</span>
              <span>7,000 Hz</span>
            </div>
          </div>

          {/* High-Pass Cutoff */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-stone-700 font-semibold">Bench Rumble Highpass Cutoff:</span>
              <span className="text-[#92400e] font-bold">{localSettings.highPassCutoff} Hz</span>
            </div>
            <input
              type="range"
              min="200"
              max="2000"
              step="50"
              value={localSettings.highPassCutoff}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, highPassCutoff: parseInt(e.target.value, 10) })
              }
              className="w-full accent-[#b45309] cursor-pointer"
            />
            <div className="flex justify-between text-[10px] font-mono text-stone-400">
              <span>200 Hz</span>
              <span>750 Hz (Eliminates Hum & Table Rumble)</span>
              <span>2,000 Hz</span>
            </div>
          </div>

          {/* Trigger Threshold & Auto-Tracking */}
          <div className="p-3 bg-[#faf7f0] rounded-xl border border-[#ded5c5] space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-stone-800 font-mono flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#b45309]" />
                Adaptive Auto-Threshold
              </label>
              <input
                type="checkbox"
                checked={localSettings.autoThreshold}
                onChange={(e) => setLocalSettings({ ...localSettings, autoThreshold: e.target.checked })}
                className="w-4 h-4 accent-[#b45309] rounded cursor-pointer"
              />
            </div>
            <p className="text-[10px] text-stone-500 font-mono">
              Automatically tracks ambient background noise and floats the trigger 3.2x above noise floor.
            </p>

            {!localSettings.autoThreshold && (
              <div className="space-y-1 pt-1.5 border-t border-[#ded5c5]">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-stone-700">Manual Sensitivity:</span>
                  <span className="text-amber-800 font-bold">
                    {(localSettings.sensitivityThreshold * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.02"
                  max="0.6"
                  step="0.01"
                  value={localSettings.sensitivityThreshold}
                  onChange={(e) =>
                    setLocalSettings({ ...localSettings, sensitivityThreshold: parseFloat(e.target.value) })
                  }
                  className="w-full accent-[#b45309] cursor-pointer"
                />
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 bg-[#faf7f0] border-t border-[#ded5c5]">
          <button
            onClick={() =>
              setLocalSettings({
                deviceId: 'default',
                gainMultiplier: 3000,
                highPassCutoff: 1000,
                bandPassFreq: 5000,
                sensitivityThreshold: 0.08,
                autoThreshold: true,
                lockoutRatio: 0.55,
                noiseGate: 0.035,
              })
            }
            className="text-xs font-mono text-stone-600 hover:text-stone-900"
          >
            Reset Defaults
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 text-xs font-mono text-stone-600 hover:text-stone-900"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 text-xs font-mono font-bold bg-[#78350f] text-white hover:bg-[#5c2b0c] rounded-lg shadow-xs transition"
            >
              Save & Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
