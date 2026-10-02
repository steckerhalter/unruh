/**
 * ChronoScope - Oscilloscope Rate Trend Timeline
 * Precision watchmaker rate regulator oscilloscope with rock-solid framing,
 * warm walnut brown 0 s/d target line, golden amber rate trace,
 * and controls docked to the right to preserve vertical canvas height.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { BeatMeasurement, TimeWindowSec } from '../types/timegrapher';
import {
  Target,
  RotateCcw,
  Pause,
  Play,
  Lock,
  ChevronDown
} from 'lucide-react';

export type SmoothingLevel = 'raw' | 'curve-5' | 'curve-9';

export type YScaleMode =
  | 'regulator-fast'      // -20 to +160 s/d: Target near bottom, max resolution for fast watches
  | 'regulator-fast-wide' // -30 to +320 s/d: Coarse high-beat fast watches
  | 'regulator-slow'      // -160 to +20 s/d: Target near top, max resolution for slow watches
  | 'centered-fine'       // -20 to +20 s/d: Chronometer grade regulation
  | 'centered-standard'   // -50 to +50 s/d: Balanced centered view
  | 'centered-wide'       // -100 to +100 s/d: Wide variance view
  | 'auto-lock';          // Smart Auto-Frame: Snaps to current watch rate with generous headroom, then locks firmly

interface Props {
  measurements: BeatMeasurement[];
  targetRate: number;
  timeWindow: TimeWindowSec;
  onTimeWindowChange: (w: TimeWindowSec) => void;
  onClearHistory: () => void;
  isPaused: boolean;
  onTogglePause: () => void;
  isRunning?: boolean;
}

const TIME_WINDOW_OPTIONS: { sec: TimeWindowSec; label: string }[] = [
  { sec: 15, label: '15s' },
  { sec: 30, label: '30s' },
  { sec: 60, label: '1m' },
  { sec: 300, label: '5m' },
  { sec: 900, label: '15m' },
];

export const OscilloscopeRateTrend: React.FC<Props> = ({
  measurements,
  targetRate = 0,
  timeWindow,
  onTimeWindowChange,
  onClearHistory,
  isPaused,
  onTogglePause,
  isRunning = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Default to 'regulator-fast' (-20 to +160 s/d)
  const [yScaleMode, setYScaleMode] = useState<YScaleMode>('regulator-fast');
  const [smoothingLevel, setSmoothingLevel] = useState<SmoothingLevel>('curve-5');
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number; measurement: BeatMeasurement } | null>(null);

  // Auto-lock bounds: calculated when requested or when signal first arrives, then completely locked!
  const [autoLockedBounds, setAutoLockedBounds] = useState<{ minY: number; maxY: number }>({
    minY: -20,
    maxY: 160,
  });

  // Track frozen timestamp when mic stops or pauses
  const frozenTimeRef = useRef<number | null>(null);

  // Moving average smoothing helper
  const smoothedData = useMemo(() => {
    if (smoothingLevel === 'raw' || measurements.length === 0) return measurements;
    const windowSize = smoothingLevel === 'curve-9' ? 9 : 5;
    const result: BeatMeasurement[] = [];
    for (let i = 0; i < measurements.length; i++) {
      let sum = 0;
      let count = 0;
      const start = Math.max(0, i - windowSize + 1);
      for (let j = start; j <= i; j++) {
        sum += measurements[j].rateErrorSecondsPerDay;
        count++;
      }
      result.push({
        ...measurements[i],
        rateErrorSecondsPerDay: sum / count,
      });
    }
    return result;
  }, [measurements, smoothingLevel]);

  // Most recent rate measurement (uses smoothed data when enabled)
  const latest = smoothingLevel !== 'raw' && smoothedData.length > 0
    ? smoothedData[smoothedData.length - 1]
    : measurements[measurements.length - 1];

  // Function to calculate smart locked bounds from current signal
  const computeSmartBounds = (rate: number): { minY: number; maxY: number } => {
    if (rate >= 15) {
      const ceiling = Math.max(160, Math.ceil((rate + 50) / 25) * 25);
      return { minY: -20, maxY: ceiling };
    } else if (rate <= -15) {
      const floor = Math.min(-160, Math.floor((rate - 50) / 25) * 25);
      return { minY: floor, maxY: 20 };
    } else {
      return { minY: -25, maxY: 25 };
    }
  };

  const handleReframe = () => {
    if (latest) {
      setAutoLockedBounds(computeSmartBounds(latest.rateErrorSecondsPerDay));
    }
  };

  // Statistics over visible window
  const stats = useMemo(() => {
    if (measurements.length === 0) {
      return { avg: 0, min: 0, max: 0, stdDev: 0, count: 0 };
    }
    const cutoff = performance.now() - timeWindow * 1000;
    const visible = measurements.filter((m) => m.timestamp >= cutoff);
    if (visible.length === 0) {
      const last = measurements[measurements.length - 1];
      return { avg: last.rateErrorSecondsPerDay, min: last.rateErrorSecondsPerDay, max: last.rateErrorSecondsPerDay, stdDev: 0, count: 1 };
    }

    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const m of visible) {
      const v = m.rateErrorSecondsPerDay;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const avg = sum / visible.length;
    let sumSqDiff = 0;
    for (const m of visible) {
      sumSqDiff += Math.pow(m.rateErrorSecondsPerDay - avg, 2);
    }
    const stdDev = Math.sqrt(sumSqDiff / visible.length);

    return { avg, min, max, stdDev, count: visible.length };
  }, [measurements, timeWindow]);

  // Canvas drawing loop (Yellow/Brown/Khaki Palette on Cream)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const render = () => {
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

      // Warm ivory parchment background (#faf7f0)
      ctx.fillStyle = '#faf7f0';
      ctx.fillRect(0, 0, width, height);

      // Determine Y scale bounds
      let minY = -20;
      let maxY = 160;

      if (yScaleMode === 'regulator-fast') {
        minY = -20;
        maxY = 160;
      } else if (yScaleMode === 'regulator-fast-wide') {
        minY = -30;
        maxY = 320;
      } else if (yScaleMode === 'regulator-slow') {
        minY = -160;
        maxY = 20;
      } else if (yScaleMode === 'centered-fine') {
        minY = -20;
        maxY = 20;
      } else if (yScaleMode === 'centered-standard') {
        minY = -50;
        maxY = 50;
      } else if (yScaleMode === 'centered-wide') {
        minY = -100;
        maxY = 100;
      } else if (yScaleMode === 'auto-lock') {
        minY = autoLockedBounds.minY;
        maxY = autoLockedBounds.maxY;
      }

      // Coordinate transformers
      const paddingLeft = 56;
      const paddingRight = 12;
      const paddingTop = 16;
      const paddingBottom = 22;
      const plotWidth = width - paddingLeft - paddingRight;
      const plotHeight = height - paddingTop - paddingBottom;

      const yRange = maxY - minY || 1;
      const rateToY = (rate: number) => {
        const normalized = (rate - minY) / yRange;
        return paddingTop + plotHeight * (1 - normalized);
      };

      // Reference time
      let now: number;
      if (!isRunning || isPaused) {
        if (frozenTimeRef.current === null) {
          frozenTimeRef.current = latest ? latest.timestamp : performance.now();
        }
        now = frozenTimeRef.current;
      } else {
        frozenTimeRef.current = null;
        now = performance.now();
      }

      const windowMs = timeWindow * 1000;
      const timeToX = (timestamp: number) => {
        const elapsedSinceBeat = now - timestamp;
        const ratio = 1 - elapsedSinceBeat / windowMs;
        return paddingLeft + ratio * plotWidth;
      };

      // 1. Oscilloscope Grid (Subtle warm khaki lines)
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(180, 160, 135, 0.45)';
      const gridCols = 8;
      for (let c = 0; c <= gridCols; c++) {
        const x = paddingLeft + (plotWidth / gridCols) * c;
        ctx.beginPath();
        ctx.moveTo(x, paddingTop);
        ctx.lineTo(x, height - paddingBottom);
        ctx.stroke();

        // Time ticks
        if (c > 0 && c < gridCols) {
          const timeOffsetSec = Math.round(((gridCols - c) / gridCols) * timeWindow);
          ctx.fillStyle = '#8c7e6b';
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`-${timeOffsetSec}s`, x, height - paddingBottom + 13);
        }
      }

      // Horizontal rate grid lines
      let step = 10;
      if (yRange > 250) step = 50;
      else if (yRange > 120) step = 25;
      else if (yRange > 60) step = 10;
      else if (yRange > 25) step = 5;
      else step = 2;

      const firstGridVal = Math.ceil(minY / step) * step;
      for (let r = firstGridVal; r <= maxY; r += step) {
        const y = rateToY(r);
        if (y < paddingTop || y > height - paddingBottom) continue;

        ctx.strokeStyle = r === 0 ? 'rgba(120, 53, 15, 0.5)' : 'rgba(180, 160, 135, 0.4)';
        ctx.beginPath();
        ctx.setLineDash(r === 0 ? [] : [2, 4]);
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(width - paddingRight, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Y-axis label
        ctx.fillStyle = r === 0 ? '#78350f' : '#6b5c49';
        ctx.font = r === 0 ? '700 10px "JetBrains Mono", monospace' : '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        const sign = r > 0 ? '+' : '';
        ctx.fillText(`${sign}${r.toFixed(0)} s/d`, paddingLeft - 5, y + 3.5);
      }

      // 2. TARGET ZERO LINE (0 s/d Reference) - Rich Walnut Chestnut Brown
      const targetY = rateToY(targetRate);
      if (targetY >= paddingTop && targetY <= height - paddingBottom) {
        // Warm brown glow aura
        ctx.strokeStyle = 'rgba(120, 53, 15, 0.16)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(paddingLeft, targetY);
        ctx.lineTo(width - paddingRight, targetY);
        ctx.stroke();

        // Crisp Deep Chestnut Brown Target Line
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 1.75;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(paddingLeft, targetY);
        ctx.lineTo(width - paddingRight, targetY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Target Badge Label on right edge in Brown/Gold
        ctx.fillStyle = '#78350f';
        ctx.fillRect(width - paddingRight - 84, targetY - 9, 82, 18);
        ctx.strokeStyle = '#5c2b0c';
        ctx.lineWidth = 1;
        ctx.strokeRect(width - paddingRight - 84, targetY - 9, 82, 18);
        ctx.fillStyle = '#fef8e7';
        ctx.font = '700 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`TARGET: 0 s/d`, width - paddingRight - 43, targetY + 3.5);
      }

      // 3. Render Rate Trend Phosphor Oscilloscope Line (Golden Ochre / Amber Brass)
      const dataToDraw = smoothingLevel !== 'raw' ? smoothedData : measurements;
      const cutoffTime = now - windowMs;
      const visibleData = dataToDraw.filter((m) => m.timestamp >= cutoffTime);

      if (visibleData.length > 1) {
        const points = visibleData.map((pt) => ({
          x: timeToX(pt.timestamp),
          y: rateToY(pt.rateErrorSecondsPerDay),
          isTick: pt.isTick,
        }));

        // Warm golden glow underlay
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(194, 120, 3, 0.22)';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        if (smoothingLevel !== 'raw' && points.length > 2) {
          for (let i = 0; i < points.length - 1; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
          }
          ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        } else {
          for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
          }
        }
        ctx.stroke();

        // Main laser trace line (Warm golden amber #c27803)
        ctx.lineWidth = 2.25;
        ctx.strokeStyle = '#b45309';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        if (smoothingLevel !== 'raw' && points.length > 2) {
          for (let i = 0; i < points.length - 1; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
          }
          ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        } else {
          for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
          }
        }
        ctx.stroke();

        // Individual measurement dots: Golden Ochre (tick) & Deep Chestnut (tock)
        for (const pt of points) {
          ctx.fillStyle = pt.isTick ? '#d97706' : '#78350f';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 4. Live Tracking Indicator (Rightmost point)
      if (latest && visibleData.length > 0) {
        const lastX = timeToX(latest.timestamp);
        const lastY = rateToY(latest.rateErrorSecondsPerDay);

        // Blinking cursor ring
        const pulse = 4 + Math.sin(now * 0.008) * 2;
        ctx.strokeStyle = 'rgba(180, 83, 9, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(lastX, lastY, pulse, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
        ctx.fill();

        // Floating current rate callout
        const calloutRate = latest.rateErrorSecondsPerDay;
        const sign = calloutRate > 0 ? '+' : '';
        const calloutText = `${sign}${calloutRate.toFixed(1)} s/d`;
        ctx.font = '600 11px "JetBrains Mono", monospace';
        const textWidth = ctx.measureText(calloutText).width;

        const badgeX = Math.min(width - paddingRight - textWidth - 10, lastX + 8);
        const badgeY = Math.max(paddingTop + 12, Math.min(height - paddingBottom - 12, lastY));

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(badgeX - 4, badgeY - 9, textWidth + 8, 17);
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 1;
        ctx.strokeRect(badgeX - 4, badgeY - 9, textWidth + 8, 17);

        ctx.fillStyle = calloutRate >= 0 ? '#78350f' : '#991b1b';
        ctx.textAlign = 'left';
        ctx.fillText(calloutText, badgeX, badgeY + 3);
      }

      // 5. Crosshair Probe on Hover
      if (hoverPoint) {
        ctx.strokeStyle = 'rgba(180, 83, 9, 0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);

        ctx.beginPath();
        ctx.moveTo(hoverPoint.x, paddingTop);
        ctx.lineTo(hoverPoint.x, height - paddingBottom);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(paddingLeft, hoverPoint.y);
        ctx.lineTo(width - paddingRight, hoverPoint.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.arc(hoverPoint.x, hoverPoint.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // 6. Standby Overlay when mic is inactive
      if (!isRunning && measurements.length === 0) {
        ctx.fillStyle = 'rgba(250, 247, 240, 0.94)';
        ctx.fillRect(paddingLeft + 10, paddingTop + plotHeight / 2 - 32, plotWidth - 20, 64);
        ctx.strokeStyle = '#ded5c5';
        ctx.lineWidth = 1;
        ctx.strokeRect(paddingLeft + 10, paddingTop + plotHeight / 2 - 32, plotWidth - 20, 64);

        ctx.fillStyle = '#78350f';
        ctx.font = '700 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('STANDBY — CLICK "LIVE MIC" OR "SIMULATE" TO GRAPH', width / 2, paddingTop + plotHeight / 2 - 8);

        ctx.fillStyle = '#78716c';
        ctx.font = '11px sans-serif';
        ctx.fillText('Trace will lock firmly onto target without unwanted viewport jitter.', width / 2, paddingTop + plotHeight / 2 + 14);
      }

      ctx.restore();

      if (isRunning && !isPaused) {
        animationId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [
    measurements,
    smoothedData,
    smoothingLevel,
    timeWindow,
    yScaleMode,
    targetRate,
    autoLockedBounds,
    isPaused,
    isRunning,
    hoverPoint,
    latest,
  ]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || measurements.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const paddingLeft = 56;
    const paddingRight = 12;
    const plotWidth = rect.width - paddingLeft - paddingRight;

    if (mouseX < paddingLeft || mouseX > rect.width - paddingRight) {
      setHoverPoint(null);
      return;
    }

    const now = frozenTimeRef.current !== null ? frozenTimeRef.current : performance.now();
    const windowMs = timeWindow * 1000;
    const hoverTime = now - (1 - (mouseX - paddingLeft) / plotWidth) * windowMs;

    let closest = measurements[0];
    let minDiff = Math.abs(closest.timestamp - hoverTime);
    for (const m of measurements) {
      const diff = Math.abs(m.timestamp - hoverTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = m;
      }
    }

    if (minDiff < windowMs * 0.05) {
      setHoverPoint({ x: mouseX, y: mouseY, measurement: closest });
    } else {
      setHoverPoint(null);
    }
  };

  const handleMouseLeave = () => {
    setHoverPoint(null);
  };

  return (
    <div className="flex flex-col bg-white border border-[#ded5c5] rounded-xl overflow-hidden shadow-xs">
      {/* 1-Line Slim Top Header (Zero wasted vertical space) */}
      <div className="flex items-center justify-between px-3 py-1 bg-[#fdfcf9] border-b border-[#ded5c5] text-[11px] font-mono">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-stone-900 flex items-center gap-1.5 font-display text-xs">
            <Target className="w-3.5 h-3.5 text-[#78350f]" />
            RATE OSCILLOSCOPE
          </span>
          <span className="text-stone-300">·</span>
          <span className="text-stone-600">
            Target: <strong className="text-[#78350f]">0.0 s/d</strong>
          </span>
          {latest && (
            <>
              <span className="text-stone-300">·</span>
              <span>
                Instant:{' '}
                <strong className={latest.rateErrorSecondsPerDay >= 0 ? 'text-[#b45309]' : 'text-rose-700'}>
                  {latest.rateErrorSecondsPerDay >= 0 ? '+' : ''}
                  {latest.rateErrorSecondsPerDay.toFixed(1)} s/d
                </strong>
              </span>
            </>
          )}
        </div>

        {/* Guidance tip on Regulator Mode */}
        {yScaleMode === 'regulator-fast' && (
          <span className="hidden sm:inline text-[10px] text-[#78350f] bg-[#fef8e7] px-2 py-0.5 rounded border border-[#fde68a]">
            Adjust index arm to pull trace down to 0 s/d line
          </span>
        )}
      </div>

      {/* Main Body: Canvas on Left, Controls Docked to the Right (No wasted vertical space!) */}
      <div className="flex flex-col sm:flex-row items-stretch">
        {/* Canvas Viewport - Condensed height */}
        <div ref={containerRef} className="relative flex-1 h-[280px] sm:h-[305px] lg:h-[320px] bg-[#faf7f0]">
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="w-full h-full cursor-crosshair block"
          />

          {/* Hover Probe Tooltip */}
          {hoverPoint && (
            <div
              className="absolute pointer-events-none z-20 px-2.5 py-1.5 bg-white/95 border border-[#ded5c5] rounded-md shadow-md text-[10px] font-mono text-stone-800"
              style={{
                left: Math.min(hoverPoint.x + 10, (containerRef.current?.clientWidth || 300) - 150),
                top: Math.max(8, hoverPoint.y - 40),
              }}
            >
              <div className="flex items-center justify-between gap-2 text-stone-900 font-semibold border-b border-stone-200 pb-0.5 mb-1">
                <span>Rate:</span>
                <span className={hoverPoint.measurement.rateErrorSecondsPerDay >= 0 ? 'text-[#b45309]' : 'text-rose-700'}>
                  {hoverPoint.measurement.rateErrorSecondsPerDay >= 0 ? '+' : ''}
                  {hoverPoint.measurement.rateErrorSecondsPerDay.toFixed(1)} s/d
                </span>
              </div>
              <div className="text-stone-600 flex justify-between gap-2">
                <span>Amp: <strong className="text-stone-900">{hoverPoint.measurement.amplitudeDeg}°</strong></span>
                <span>·</span>
                <span>Beat Err: <strong className="text-stone-900">{hoverPoint.measurement.beatErrorMs.toFixed(1)}ms</strong></span>
              </div>
            </div>
          )}
        </div>

        {/* Right-Docked Vertical Controls Strip (Takes zero vertical space from the graph!) */}
        <div className="w-full sm:w-36 lg:w-40 bg-[#fdfcf9] border-t sm:border-t-0 sm:border-l border-[#ded5c5] p-2 flex flex-col justify-between text-[11px] font-mono space-y-2">
          <div className="space-y-1.5">
            {/* Time Span Grid */}
            <div>
              <span className="text-[10px] text-stone-500 uppercase tracking-wider block mb-1">Window:</span>
              <div className="grid grid-cols-4 sm:grid-cols-2 gap-1">
                {TIME_WINDOW_OPTIONS.map((opt) => (
                  <button
                    key={opt.sec}
                    onClick={() => onTimeWindowChange(opt.sec)}
                    className={`py-1 px-1.5 text-[10px] rounded transition text-center ${
                      timeWindow === opt.sec
                        ? 'bg-[#78350f] text-white font-bold shadow-xs'
                        : 'bg-[#f5f0e4] text-stone-700 hover:bg-[#ede5d5] border border-[#e5decb]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Regulator Scale Presets */}
            <div className="pt-1.5 border-t border-[#eee5d5] space-y-1">
              <span className="text-[10px] text-stone-500 uppercase tracking-wider block">Scale Mode:</span>
              <button
                onClick={() => setYScaleMode('regulator-fast')}
                className={`w-full py-1 px-1.5 text-[10px] rounded transition text-left flex items-center justify-between ${
                  yScaleMode === 'regulator-fast'
                    ? 'bg-[#fef3c7] text-[#78350f] font-bold border border-[#fde68a]'
                    : 'bg-[#f5f0e4] text-stone-700 hover:bg-[#ede5d5] border border-[#e5decb]'
                }`}
                title="Target 0 at bottom (-20 to +160 s/d). Perfect for fast watches."
              >
                <span>Fast (0→+160)</span>
                {yScaleMode === 'regulator-fast' && <span className="w-1.5 h-1.5 rounded-full bg-[#78350f]" />}
              </button>

              <button
                onClick={() => setYScaleMode('regulator-slow')}
                className={`w-full py-1 px-1.5 text-[10px] rounded transition text-left flex items-center justify-between ${
                  yScaleMode === 'regulator-slow'
                    ? 'bg-[#fef3c7] text-[#78350f] font-bold border border-[#fde68a]'
                    : 'bg-[#f5f0e4] text-stone-700 hover:bg-[#ede5d5] border border-[#e5decb]'
                }`}
                title="Target 0 at top (-160 to +20 s/d). For slow watches."
              >
                <span>Slow (-160→0)</span>
                {yScaleMode === 'regulator-slow' && <span className="w-1.5 h-1.5 rounded-full bg-[#78350f]" />}
              </button>

              <button
                onClick={() => {
                  setYScaleMode('auto-lock');
                  handleReframe();
                }}
                className={`w-full py-1 px-1.5 text-[10px] rounded transition text-left flex items-center justify-between ${
                  yScaleMode === 'auto-lock'
                    ? 'bg-[#fef3c7] text-[#78350f] font-bold border border-[#fde68a]'
                    : 'bg-[#f5f0e4] text-stone-700 hover:bg-[#ede5d5] border border-[#e5decb]'
                }`}
              >
                <span className="flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5 text-[#78350f]" /> Auto-Lock
                </span>
                {yScaleMode === 'auto-lock' && <span className="w-1.5 h-1.5 rounded-full bg-[#78350f]" />}
              </button>

              {/* Other Scales */}
              <select
                value={yScaleMode}
                onChange={(e) => setYScaleMode(e.target.value as YScaleMode)}
                className="w-full bg-[#f5f0e4] border border-[#e5decb] text-stone-800 rounded px-1.5 py-1 text-[10px] focus:outline-none"
              >
                <option value="regulator-fast">Fast (0→+160)</option>
                <option value="regulator-fast-wide">Coarse (0→+320)</option>
                <option value="regulator-slow">Slow (-160→0)</option>
                <option value="centered-fine">±20 s/d (Fine)</option>
                <option value="centered-standard">±50 s/d (Std)</option>
                <option value="centered-wide">±100 s/d (Wide)</option>
              </select>
            </div>

            {/* Spline & Action Toggles */}
            <div className="pt-1.5 border-t border-[#eee5d5] space-y-1">
              <span className="text-[10px] text-stone-500 uppercase tracking-wider block">Filter & State:</span>
              <button
                onClick={() => {
                  setSmoothingLevel((prev) =>
                    prev === 'curve-5' ? 'curve-9' : prev === 'curve-9' ? 'raw' : 'curve-5'
                  );
                }}
                className="w-full py-1 px-1.5 text-[10px] bg-[#f5f0e4] hover:bg-[#ede5d5] border border-[#e5decb] text-stone-700 rounded transition text-center"
              >
                {smoothingLevel === 'curve-5' ? 'Spline: Smooth' : smoothingLevel === 'curve-9' ? 'Spline: Ultra' : 'Spline: Raw'}
              </button>

              <div className="grid grid-cols-2 gap-1 pt-0.5">
                <button
                  onClick={onTogglePause}
                  className={`py-1 text-[10px] rounded transition flex items-center justify-center gap-1 ${
                    isPaused
                      ? 'bg-[#fef3c7] text-[#78350f] font-bold border border-[#fde68a]'
                      : 'bg-[#f5f0e4] text-stone-700 hover:bg-[#ede5d5] border border-[#e5decb]'
                  }`}
                  title={isPaused ? 'Resume trace' : 'Freeze trace'}
                >
                  {isPaused ? <Play className="w-2.5 h-2.5" /> : <Pause className="w-2.5 h-2.5" />}
                  {isPaused ? 'Play' : 'Pause'}
                </button>
                <button
                  onClick={onClearHistory}
                  className="py-1 text-[10px] bg-[#f5f0e4] hover:bg-rose-50 text-stone-700 hover:text-rose-700 border border-[#e5decb] hover:border-rose-200 rounded transition flex items-center justify-center gap-1"
                  title="Clear graph trace"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Clear
                </button>
              </div>
            </div>
          </div>

          {/* Compact Vertical Live Telemetry Stats */}
          <div className="pt-1.5 border-t border-[#ded5c5] text-[10px] space-y-0.5 text-stone-600">
            <div className="flex justify-between">
              <span className="text-stone-400">Avg:</span>
              <strong className={stats.avg >= 0 ? 'text-[#78350f]' : 'text-rose-700'}>
                {stats.avg >= 0 ? '+' : ''}{stats.avg.toFixed(1)} s/d
              </strong>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-400">Range:</span>
              <span>{stats.min.toFixed(0)}/{stats.max.toFixed(0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-400">Stab σ:</span>
              <span>±{stats.stdDev.toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
