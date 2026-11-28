/**
 * WaveformViewer — draws the live audio waveform (the engine's recent input
 * samples) and shows the source label — "Live Mic", "Simulated Pulses" or
 * "Recording" — with a progress indicator while a recording plays.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../services/audioEngine';

interface Props {
  engineRef: React.MutableRefObject<AudioEngine | null>;
  height?: number;
}

export const WaveformViewer: React.FC<Props> = ({ engineRef, height = 100 }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [label, setLabel] = useState<string>('…');
  const [progress, setProgress] = useState<{ elapsedSec: number; totalSec: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    const draw = () => {
      const engine = engineRef.current;
      if (!engine) return;
      const rect = canvas.getBoundingClientRect();
      const cw = Math.max(1, Math.round(rect.width));
      const ch = Math.max(1, Math.round(rect.height));
      if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
      }
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#faf7f0';
      ctx.fillRect(0, 0, cw, ch);
      const samples = engine.getWaveform();
      const midY = ch / 2;
      const amp = (ch / 2) * 0.96;
      if (samples.length > 1) {
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const n = samples.length;
        // Draw the min/max of each pixel column, not a single sampled point.
        // The ring buffer holds ~19k samples for ~1k pixels, so point-sampling
        // aliases badly: the picture changes every redraw and a dense burst can
        // look like noise (or vice versa). One vertical line per column shows
        // the real envelope.
        for (let x = 0; x < cw; x++) {
          const a = Math.floor((x / cw) * n);
          const b = Math.max(a + 1, Math.min(n, Math.floor(((x + 1) / cw) * n)));
          let lo = samples[a];
          let hi = samples[a];
          for (let i = a + 1; i < b; i++) {
            const v = samples[i];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          ctx.moveTo(x + 0.5, midY - hi * amp);
          ctx.lineTo(x + 0.5, midY - lo * amp);
        }
        ctx.stroke();
      }
      ctx.restore();

      const p = engine.getRecordingProgress();
      setProgress(p);
      if (p) {
        setLabel('Recording');
      } else if (engine.getIsSimulating()) {
        setLabel('Simulated Pulses');
      } else {
        setLabel('Live Mic');
      }
    };

    draw();
    const interval = setInterval(draw, 60);
    return () => clearInterval(interval);
  }, [engineRef]);

  const p = progress;
  const isRecording = !!p && p.totalSec > 0;
  const pct = isRecording ? Math.min(1, Math.max(0, p.elapsedSec / p.totalSec)) : 0;

  return (
    <div className="bg-white border border-[#ded5c5] rounded-xl p-2.5 shadow-xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono text-stone-500 font-semibold uppercase tracking-wider">
          Waveform — {label}
        </span>
        {isRecording && (
          <span className="text-[10px] font-mono text-[#78350f] font-bold tabular-nums shrink-0">
            {p.elapsedSec.toFixed(1)} / {p.totalSec.toFixed(1)}s — {(pct * 100).toFixed(0)}%
          </span>
        )}
      </div>
      {isRecording && (
        <div className="h-1.5 bg-[#eee5d5] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#78350f] rounded-full transition-all duration-150"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      )}
      <canvas ref={canvasRef} className="w-full block" style={{ height: `${height}px` }} />
    </div>
  );
};
