/**
 * ChronoScope - Classic Timegrapher Dual-Dot Matrix Trace
 * Emulates the traditional physical paper tape roll timegrapher display (e.g. Witschi / TG).
 * Styled in warm creamy parchment aesthetic with yellow/brown/khaki contrast dots.
 */

import React, { useEffect, useRef } from 'react';
import { BeatMeasurement } from '../types/timegrapher';

interface Props {
  measurements: BeatMeasurement[];
  targetRate: number;
}

export const ClassicTimegrapherTape: React.FC<Props> = ({ measurements, targetRate = 0 }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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

    // Creamy paper tape background with faint grid
    ctx.fillStyle = '#faf7f0';
    ctx.fillRect(0, 0, width, height);

    // Subtle horizontal baseline grid
    ctx.strokeStyle = 'rgba(180, 160, 135, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);

    const rows = 12;
    for (let r = 1; r < rows; r++) {
      const y = (height / rows) * r;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Zero reference center line (Walnut brown)
    const midY = height / 2;
    ctx.strokeStyle = 'rgba(120, 53, 15, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    // Render the dual dot traces
    const maxDots = Math.floor(width / 3);
    const recent = measurements.slice(-maxDots);

    if (recent.length > 0) {
      let cumulativePhaseTick = 0;
      let cumulativePhaseTock = 0;
      const dotSpacing = 3;

      for (let i = 0; i < recent.length; i++) {
        const m = recent[i];
        const x = width - (recent.length - i) * dotSpacing;
        if (x < 0) continue;

        const rateDelta = m.rateErrorSecondsPerDay - targetRate;
        const phaseShift = (rateDelta / 86400) * 800;
        const beatErrShift = (m.beatErrorMs / 2) * 12;

        if (m.isTick) {
          cumulativePhaseTick += phaseShift;
          const y = midY + cumulativePhaseTick + beatErrShift;
          const wrappedY = ((y % height) + height) % height;

          // Golden Ochre Yellow tick dot
          ctx.fillStyle = '#d97706';
          ctx.fillRect(x, wrappedY, 2.5, 2.5);
        } else {
          cumulativePhaseTock += phaseShift;
          const y = midY + cumulativePhaseTock - beatErrShift;
          const wrappedY = ((y % height) + height) % height;

          // Rich Walnut Chestnut Brown tock dot
          ctx.fillStyle = '#78350f';
          ctx.fillRect(x, wrappedY, 2.5, 2.5);
        }
      }
    } else {
      ctx.fillStyle = '#8c7e6b';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Awaiting acoustic beat pulses for dot matrix plot...', width / 2, midY - 6);
    }

    ctx.restore();
  }, [measurements, targetRate]);

  return (
    <div className="flex flex-col bg-white border border-[#ded5c5] rounded-xl overflow-hidden shadow-xs">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#fdfcf9] border-b border-[#ded5c5] text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-stone-900 tracking-wide font-display text-xs">
            CLASSIC DUAL-DOT TIMEGRAPHER TRACE
          </span>
          <span className="text-stone-300 font-mono">·</span>
          <span className="text-stone-600 font-mono text-[10px]">
            Parallel lines: Slope = Rate · Gap = Beat Error
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="flex items-center gap-1.5 text-stone-700">
            <span className="w-2.5 h-2.5 rounded-full bg-[#d97706]"></span> Tick (Yellow)
          </span>
          <span className="flex items-center gap-1.5 text-stone-700">
            <span className="w-2.5 h-2.5 rounded-full bg-[#78350f]"></span> Tock (Brown)
          </span>
        </div>
      </div>
      <div className="relative w-full h-[200px] md:h-[240px] bg-[#faf7f0]">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
};
