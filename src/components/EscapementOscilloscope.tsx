/**
 * Unruh - Escapement Pulse Waveform Oscilloscope
 * Visualizes the unlock and banking impacts of the Swiss lever escapement
 * to compute balance amplitude.
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

      // Snippet total duration in ms. Use the real sample rate the beat was
      // captured at — assuming 48 kHz shifted every marker on 44.1 kHz devices.
      const sampleRate = activeBeat.snippetSampleRate ?? 48000;
      const totalSnippetMs = (len / sampleRate) * 1000;

      // Map dynamic timestamps to snippet relative ratios
      const unlockRatio = Math.min(1.0, Math.max(0.0, activeBeat.unlockMs / totalSnippetMs));
      const bankingRatio = Math.min(1.0, Math.max(0.0, activeBeat.bankingMs / totalSnippetMs));

      const unlockX = padL + unlockRatio * plotW;
      const bankingX = padL + bankingRatio * plotW;

      // Unlocking edge (Walnut Brown)
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(unlockX, padT);
      ctx.lineTo(unlockX, height - padB);
      ctx.stroke();

      // Drop / banking impact (Emerald Green)
      ctx.strokeStyle = '#059669';
      ctx.beginPath();
      ctx.moveTo(bankingX, padT);
      ctx.lineTo(bankingX, height - padB);
      ctx.stroke();
      ctx.setLineDash([]);

      // Lift-time bracket from unlock to banking (Chestnut Brown)
      const bracketY = padT + 14;
      ctx.strokeStyle = '#5c2b0c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(unlockX, bracketY);
      ctx.lineTo(bankingX, bracketY);
      ctx.moveTo(unlockX, bracketY - 3);
      ctx.lineTo(unlockX, bracketY + 3);
      ctx.moveTo(bankingX, bracketY - 3);
      ctx.lineTo(bankingX, bracketY + 3);
      ctx.stroke();

      // Lift-time label
      ctx.fillStyle = '#5c2b0c';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Lift time ≈ ${activeBeat.liftTimeMs.toFixed(2)} ms`, (unlockX + bankingX) / 2, bracketY - 5);

      // Marker labels
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#78350f';
      ctx.fillText('Unlock', unlockX, height - padB + 13);

      ctx.fillStyle = '#059669';
      ctx.fillText('Banking (est.)', bankingX, height - padB + 13);
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
