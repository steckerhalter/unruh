/**
 * ChronoScope - Interactive Watch Movement Simulator & Virtual Regulator
 * Allows testing the app immediately, with presets and a virtual regulator arm
 * to test pulling a fast watch down to the 0 s/d target line in real time.
 * Condensed in height with controls docked to the right and warm yellow/brown/khaki styling.
 */

import React from 'react';
import { BphOption, COMMON_BPH_PRESETS, SimulatorConfig } from '../types/timegrapher';
import { Sparkles, Gauge, Target } from 'lucide-react';

interface Props {
  config: SimulatorConfig;
  onChangeConfig: (newConfig: SimulatorConfig) => void;
  onApplyPreset: (preset: {
    name: string;
    bph: BphOption;
    rate: number;
    beatError: number;
    amplitude: number;
    noise: number;
  }) => void;
}

const SIMULATOR_PRESETS = [
  {
    name: 'Eloga Vintage (Swiss Lever 18,000 bph)',
    description: 'Vintage Swiss mechanical watch with slow 2.5 Hz beat and warm escapement profile.',
    bph: 18000 as BphOption,
    rate: 8,
    beatError: 0.2,
    amplitude: 270,
    noise: 0.04,
  },
  {
    name: 'Fast Runner (+95 s/d) - Regulator Test',
    description: 'User scenario: Watch running very fast. Adjust regulator lever below to pull down to 0 s/d!',
    bph: 21600 as BphOption,
    rate: 95,
    beatError: 0.3,
    amplitude: 275,
    noise: 0.04,
  },
  {
    name: 'ETA 2824 / Sellita SW200 (Regulated COSC)',
    description: '4 Hz high-beat Swiss movement in chronometer spec (+2 s/d, 0.1 ms).',
    bph: 28800 as BphOption,
    rate: 2,
    beatError: 0.1,
    amplitude: 295,
    noise: 0.03,
  },
  {
    name: 'Seiko NH35 / 4R36 (Factory New)',
    description: '3 Hz robust Japanese workhorse with slight factory lead (+14 s/d).',
    bph: 21600 as BphOption,
    rate: 14,
    beatError: 0.4,
    amplitude: 268,
    noise: 0.05,
  },
  {
    name: 'Vintage Pocket Watch (18,000 bph)',
    description: 'Slow-beat vintage balance with moderate beat error and lower amplitude.',
    bph: 18000 as BphOption,
    rate: -32,
    beatError: 1.4,
    amplitude: 232,
    noise: 0.08,
  },
  {
    name: 'High Beat Error Need Alignment (2.4 ms)',
    description: 'Balance wheel stud is misaligned relative to the pallet fork center rest.',
    bph: 28800 as BphOption,
    rate: -8,
    beatError: 2.4,
    amplitude: 245,
    noise: 0.05,
  },
];

export const MovementSimulatorPanel: React.FC<Props> = ({
  config,
  onChangeConfig,
  onApplyPreset,
}) => {
  return (
    <div className="bg-white border border-[#ded5c5] rounded-xl p-2.5 space-y-2 shadow-xs">
      {/* 1-Line Header with Controls to the Right */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eee5d5] pb-1.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#b45309]" />
          <h3 className="font-semibold text-stone-900 font-display text-xs">
            VIRTUAL REGULATOR & SYNTHESIZER
          </h3>
          <span className="text-stone-300 font-mono text-xs">·</span>
          <span className="text-stone-500 font-mono text-[10px] hidden sm:inline">
            Simulate mechanical escapement audio
          </span>
        </div>

        {/* Preset Selector Docked to the Right */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-stone-600">Preset:</span>
          <select
            value={config.presetName}
            onChange={(e) => {
              const selected = SIMULATOR_PRESETS.find((p) => p.name === e.target.value);
              if (selected) onApplyPreset(selected);
            }}
            className="bg-[#fdfcf9] border border-[#ded5c5] text-stone-800 rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:border-[#78350f]"
          >
            {SIMULATOR_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Virtual Regulator Arm - Condensed Horizontal Bar with Snap button docked to the right */}
      <div className="p-2 bg-[#faf7f0] border border-[#d6a95e]/50 rounded-lg flex flex-col sm:flex-row items-center gap-3">
        <div className="flex items-center gap-1.5 shrink-0">
          <Gauge className="w-3.5 h-3.5 text-[#b45309]" />
          <span className="text-[11px] font-bold text-[#78350f] font-mono uppercase">
            Regulator Index:
          </span>
          <span className="text-xs font-mono font-bold text-[#92400e] min-w-[65px]">
            {config.rateError >= 0 ? '+' : ''}
            {config.rateError.toFixed(1)} s/d
          </span>
        </div>

        {/* Center: Slider */}
        <div className="flex-1 flex items-center gap-2 w-full">
          <span className="text-[10px] font-mono text-rose-700 font-semibold shrink-0">-150s</span>
          <input
            type="range"
            min="-150"
            max="150"
            step="1"
            value={config.rateError}
            onChange={(e) => {
              const newRate = parseFloat(e.target.value);
              onChangeConfig({
                ...config,
                rateError: newRate,
                presetName: 'Custom Regulator Tuning',
              });
            }}
            className="flex-1 accent-[#b45309] cursor-pointer h-1.5 bg-[#e5decb] rounded-lg"
          />
          <span className="text-[10px] font-mono text-[#b45309] font-semibold shrink-0">+150s</span>
        </div>

        {/* Right: Snap to 0 Target Button */}
        <button
          onClick={() =>
            onChangeConfig({
              ...config,
              rateError: 0,
              presetName: 'Zero Target Calibrated',
            })
          }
          className="shrink-0 px-2 py-1 bg-[#fef3c7] border border-[#fde68a] text-[#78350f] hover:bg-[#fde68a] rounded text-[10px] font-mono font-bold transition flex items-center gap-1"
        >
          <Target className="w-3 h-3 text-[#78350f]" />
          Snap to 0 s/d
        </button>
      </div>

      {/* Secondary Movement Parameters - Ultra-condensed 3-column row */}
      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
        {/* Beat Error */}
        <div className="px-2 py-1 bg-[#faf7f0] border border-[#eee5d5] rounded flex items-center justify-between gap-1">
          <span className="text-stone-500">Beat Err:</span>
          <span className="font-bold text-stone-800">{config.beatError.toFixed(1)}ms</span>
          <input
            type="range"
            min="0.0"
            max="4.0"
            step="0.1"
            value={config.beatError}
            onChange={(e) =>
              onChangeConfig({
                ...config,
                beatError: parseFloat(e.target.value),
                presetName: 'Custom',
              })
            }
            className="w-16 accent-stone-600 cursor-pointer h-1"
          />
        </div>

        {/* Amplitude */}
        <div className="px-2 py-1 bg-[#faf7f0] border border-[#eee5d5] rounded flex items-center justify-between gap-1">
          <span className="text-stone-500">Amp:</span>
          <span className="font-bold text-emerald-700">{config.amplitude}°</span>
          <input
            type="range"
            min="180"
            max="330"
            step="5"
            value={config.amplitude}
            onChange={(e) =>
              onChangeConfig({
                ...config,
                amplitude: parseInt(e.target.value, 10),
                presetName: 'Custom',
              })
            }
            className="w-16 accent-emerald-600 cursor-pointer h-1"
          />
        </div>

        {/* Movement BPH */}
        <div className="px-2 py-1 bg-[#faf7f0] border border-[#eee5d5] rounded flex items-center justify-between gap-1">
          <span className="text-stone-500">BPH:</span>
          <select
            value={config.bph}
            onChange={(e) =>
              onChangeConfig({
                ...config,
                bph: parseInt(e.target.value, 10) as BphOption,
                presetName: 'Custom',
              })
            }
            className="bg-white border border-[#ded5c5] text-stone-800 rounded px-1 py-0.5 text-[10px] font-mono"
          >
            {COMMON_BPH_PRESETS.map((p) => (
              <option key={p.bph} value={p.bph}>
                {p.bph.toLocaleString()}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
