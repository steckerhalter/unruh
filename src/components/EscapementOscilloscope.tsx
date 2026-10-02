/**
 * ChronoScope - Escapement Pulse Waveform Oscilloscope
 * Visualizes the 3 acoustic impacts of the Swiss lever escapement:
 * 1. Unlocking (t1), 2. Impulse (t2), 3. Drop/Banking (t3) to compute Amplitude.
 * Styled in warm creamy parchment aesthetic with yellow/brown/khaki accents.
 */

import React, { useEffect, useRef, useState } from 'react';
import { BeatMeasurement } from '../types/timegrapher';
import { Activity } from 'lucide-react';

interface Props {
  latestBeat: BeatMeasurement | null;
  liftAngle: number;
}

export const EscapementOscilloscope: React.FC<Props> = ({ latestBeat, liftAngle }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isFrozen, setIsFrozen] = useState(false);
  const [frozenBeat, setFrozenBeat] = useState<BeatMeasurement | null>(null);

  const activeBeat = isFrozen ? frozenBeat : latestBeat;

  useEffect(() => {
    if (!isFrozen && latestBeat) {
      setFrozenBeat(latestBeat);
    }
  }, [latestBeat, isFrozen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = rect.height;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Warm creamy parchment background
    ctx.fillStyle = '#faf7f0';
    ctx.fillRect(0, 0, width, height);

    // Coordinate bounds
    const padL = 36;
    const padR = 16;
    const padT = 16;
    const padB = 22;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const midY = padT + plotH / 2;

    // Subgrid
    ctx.strokeStyle = 'rgba(180, 160, 135, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, midY);
    ctx.lineTo(width - padR, midY);
    ctx.stroke();

    const cols = 8;
    for (let c = 0; c <= cols; c++) {
      const x = padL + (plotW / cols) * c;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, height - padB);
      ctx.stroke();
    }

    // Outer border
    ctx.strokeStyle = '#ded5c5';
    ctx.strokeRect(padL, padT, plotW, plotH);

    if (activeBeat && activeBeat.waveformSnippet && activeBeat.waveformSnippet.length > 0) {
      const snippet = activeBeat.waveformSnippet;
      const len = snippet.length;

      // Draw the waveform in warm golden amber
      ctx.lineWidth = 1.75;
      ctx.strokeStyle = '#b45309';
      ctx.beginPath();

      for (let i = 0; i < len; i++) {
        const x = padL + (i / len) * plotW;
        const y = midY - snippet[i] * (plotH * 0.45);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Peak impact markers: Unlocking (t1), Impulse (t2), Drop/Banking (t3)
      const t1Ratio = 0.22;
      const deltaRatio = Math.min(0.4, (activeBeat.deltaTImpulseMs / 25));
      const t3Ratio = t1Ratio + deltaRatio;
      const t2Ratio = t1Ratio + deltaRatio * 0.45;

      const t1X = padL + t1Ratio * plotW;
      const t2X = padL + t2Ratio * plotW;
      const t3X = padL + t3Ratio * plotW;

      // t1: Unlocking (Walnut Brown)
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(t1X, padT);
      ctx.lineTo(t1X, height - padB);
      ctx.stroke();

      // t2: Impulse (Golden Amber)
      ctx.strokeStyle = '#d97706';
      ctx.beginPath();
      ctx.moveTo(t2X, padT);
      ctx.lineTo(t2X, height - padB);
      ctx.stroke();

      // t3: Drop / Banking (Emerald Green)
      ctx.strokeStyle = '#059669';
      ctx.beginPath();
      ctx.moveTo(t3X, padT);
      ctx.lineTo(t3X, height - padB);
      ctx.stroke();
      ctx.setLineDash([]);

      // Delta-t bracket between t1 and t3 (Chestnut Brown)
      const bracketY = padT + 14;
      ctx.strokeStyle = '#5c2b0c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(t1X, bracketY);
      ctx.lineTo(t3X, bracketY);
      ctx.moveTo(t1X, bracketY - 3);
      ctx.lineTo(t1X, bracketY + 3);
      ctx.moveTo(t3X, bracketY - 3);
      ctx.lineTo(t3X, bracketY + 3);
      ctx.stroke();

      // Delta-t label
      ctx.fillStyle = '#5c2b0c';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Δt = ${activeBeat.deltaTImpulseMs.toFixed(2)} ms`, (t1X + t3X) / 2, bracketY - 5);

      // Marker labels
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#78350f';
      ctx.fillText('t1: Unlock', t1X, height - padB + 13);

      ctx.fillStyle = '#d97706';
      ctx.fillText('t2: Impulse', t2X, height - padB + 13);

      ctx.fillStyle = '#059669';
      ctx.fillText('t3: Banking', t3X, height - padB + 13);
    } else {
      ctx.fillStyle = '#8c7e6b';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for escapement acoustic click snippet...', width / 2, midY);
    }

    ctx.restore();
  }, [activeBeat]);

  return (
    <div className="bg-white border border-[#ded5c5] rounded-xl overflow-hidden shadow-xs space-y-1.5">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#fdfcf9] border-b border-[#ded5c5] text-xs">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[#78350f]" />
          <span className="font-semibold text-stone-900 font-display text-xs">
            ESCAPEMENT ACOUSTIC PULSE WAVEFORM
          </span>
          <span className="text-stone-300 font-mono">·</span>
          <span className="text-stone-600 font-mono text-[10px]">
            Lift Angle: <strong className="text-stone-900">{liftAngle}°</strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsFrozen(!isFrozen)}
            className={`px-2 py-0.5 text-[10px] font-mono rounded border transition ${
              isFrozen
                ? 'bg-[#fef3c7] border-[#fde68a] text-[#78350f] font-bold'
                : 'bg-[#f5f0e4] border-[#ded5c5] text-stone-700 hover:text-stone-900'
            }`}
          >
            {isFrozen ? 'Unfreeze' : 'Freeze Pulse'}
          </button>
        </div>
      </div>

      <div className="p-2">
        <div className="relative w-full h-[180px] md:h-[220px] bg-[#faf7f0] rounded-lg overflow-hidden border border-[#ded5c5]">
          <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
      </div>
    </div>
  );
};
