/**
 * Unruh - Oscilloscope Rate Trend Timeline
 * Precision watchmaker rate regulator oscilloscope with rock-solid framing,
 * warm walnut brown 0 s/d target line, golden amber rate trace,
 * and controls docked to the right to preserve vertical canvas height.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { BeatMeasurement, TimeWindowSec } from '../types/timegrapher';
import {
  Target,
  RotateCcw,
} from 'lucide-react';

export type YScaleMode = 'auto-lock';

interface Props {
  measurements: BeatMeasurement[];
  targetRate?: number;
  timeWindow: TimeWindowSec;
  onTimeWindowChange: (w: TimeWindowSec) => void;
  onClearHistory: () => void;
  isPaused: boolean;
  isRunning?: boolean;
  integrationSec?: number;
  bph?: number;
  isInitializing?: boolean;
}

const TIME_WINDOW_OPTIONS: { sec: TimeWindowSec; label: string }[] = [
  { sec: 15, label: '15s' },
  { sec: 60, label: '1m' },
  { sec: 600, label: '10m' },
  { sec: 3600, label: '1h' },
];

export const OscilloscopeRateTrend: React.FC<Props> = ({
  measurements = [],
  integrationSec = 12,
  bph = 21600,
  targetRate = 0,
  timeWindow,
  onTimeWindowChange,
  onClearHistory,
  isPaused,
  isRunning = true,
  isInitializing = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [yScaleMode] = useState<YScaleMode>('auto-lock');
  // Smooth enabled by default
  const [isSmoothed, setIsSmoothed] = useState<boolean>(true);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number; measurement: BeatMeasurement } | null>(null);

  // Auto-lock bounds: recalculates and locks strictly every 5 seconds
  const [autoLockedBounds, setAutoLockedBounds] = useState<{ minY: number; maxY: number }>({
    minY: -20,
    maxY: 160,
  });

  const frozenTimeRef = useRef<number | null>(null);

  // 1. Calculate window size in beats
  const windowBeats = Math.max(1, Math.round(integrationSec * (bph / 3600)));

  // 2. High-performance running-sum smoothed data array
  const displayData = useMemo(() => {
    const len = measurements.length;
    if (len === 0) return [];

    const result = new Array<BeatMeasurement>(len);
    let runningSum = 0;

    for (let i = 0; i < len; i++) {
      runningSum += measurements[i].rateErrorSecondsPerDay;

      if (i >= windowBeats) {
        runningSum -= measurements[i - windowBeats].rateErrorSecondsPerDay;
      }

      const count = Math.min(i + 1, windowBeats);
      result[i] = {
        ...measurements[i],
        rateErrorSecondsPerDay: runningSum / count,
      };
    }

    return result;
  }, [measurements, windowBeats]);

  // Keep a fresh reference to displayData for the 5s interval timer
  const displayDataRef = useRef(displayData);
  useEffect(() => {
    displayDataRef.current = displayData;
  }, [displayData]);

  // Calculate auto bounds
  const calculateAutoBounds = (data: BeatMeasurement[]) => {
    if (!data || data.length === 0) {
      return { minY: targetRate - 20, maxY: targetRate + 20 };
    }

    let minRate = Infinity;
    let maxRate = -Infinity;

    for (let i = 0; i < data.length; i++) {
      const val = data[i].rateErrorSecondsPerDay;
      if (val < minRate) minRate = val;
      if (val > maxRate) maxRate = val;
    }

    const spread = Math.max(4, maxRate - minRate);
    const padding = spread * 0.2;

    minRate -= padding;
    maxRate += padding;

    // Ensure zero target line remains visible
    minRate = Math.min(minRate, targetRate - 1);
    maxRate = Math.max(maxRate, targetRate + 1);

    return {
      minY: Math.floor(minRate),
      maxY: Math.ceil(maxRate),
    };
  };

  // Timer: recalculates & updates scale strictly every 5 seconds
  useEffect(() => {
    const updateBounds = () => {
      setAutoLockedBounds(calculateAutoBounds(displayDataRef.current));
    };

    updateBounds();
    const intervalId = setInterval(updateBounds, 5000);

    return () => clearInterval(intervalId);
  }, [targetRate]);

  // Latest rate measurement
  const latest = isSmoothed && displayData.length > 0
    ? displayData[displayData.length - 1]
    : measurements[measurements.length - 1];

  // Statistics over visible window
  const stats = useMemo(() => {
    const len = measurements.length;
    if (len === 0) {
      return { avg: 0, min: 0, max: 0, stdDev: 0, count: 0 };
    }

    const cutoff = performance.now() - timeWindow * 1000;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    let count = 0;

    for (let i = len - 1; i >= 0; i--) {
      const m = measurements[i];
      if (m.timestamp < cutoff) break;

      const v = m.rateErrorSecondsPerDay;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
      count++;
    }

    if (count === 0) {
      const last = measurements[len - 1];
      return { avg: last.rateErrorSecondsPerDay, min: last.rateErrorSecondsPerDay, max: last.rateErrorSecondsPerDay, stdDev: 0, count: 1 };
    }

    const avg = sum / count;
    let sumSqDiff = 0;

    for (let i = len - count; i < len; i++) {
      sumSqDiff += Math.pow(measurements[i].rateErrorSecondsPerDay - avg, 2);
    }

    return { avg, min, max, stdDev: Math.sqrt(sumSqDiff / count), count };
  }, [measurements, timeWindow]);

  // Canvas drawing loop
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

      if (width === 0 || height === 0) return;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Warm ivory parchment background (#faf7f0)
      ctx.fillStyle = '#faf7f0';
      ctx.fillRect(0, 0, width, height);

      const minY = autoLockedBounds.minY;
      const maxY = autoLockedBounds.maxY;

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

      // 1. Grid
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(180, 160, 135, 0.45)';
      const gridCols = 8;
      for (let c = 0; c <= gridCols; c++) {
        const x = paddingLeft + (plotWidth / gridCols) * c;
        ctx.beginPath();
        ctx.moveTo(x, paddingTop);
        ctx.lineTo(x, height - paddingBottom);
        ctx.stroke();

        if (c > 0 && c < gridCols) {
          const timeOffsetSec = Math.round(((gridCols - c) / gridCols) * timeWindow);
          ctx.fillStyle = '#8c7e6b';
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`-${timeOffsetSec}s`, x, height - paddingBottom + 13);
        }
      }

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

        ctx.fillStyle = r === 0 ? '#78350f' : '#6b5c49';
        ctx.font = r === 0 ? '700 10px "JetBrains Mono", monospace' : '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        const sign = r > 0 ? '+' : '';
        ctx.fillText(`${sign}${r.toFixed(0)} s/d`, paddingLeft - 5, y + 3.5);
      }

      // 2. Target zero line
      const targetY = rateToY(targetRate);
      if (targetY >= paddingTop && targetY <= height - paddingBottom) {
        ctx.strokeStyle = 'rgba(120, 53, 15, 0.16)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(paddingLeft, targetY);
        ctx.lineTo(width - paddingRight, targetY);
        ctx.stroke();

        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 1.75;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(paddingLeft, targetY);
        ctx.lineTo(width - paddingRight, targetY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 3. Trace line
      const dataToDraw = isSmoothed ? displayData : measurements;
      const cutoffTime = now - windowMs;

      let startIdx = 0;
      while (startIdx < dataToDraw.length && dataToDraw[startIdx].timestamp < cutoffTime) {
        startIdx++;
      }
      const visibleData = dataToDraw.slice(startIdx);

      if (visibleData.length > 1) {
        const points = visibleData.map((pt) => ({
          x: timeToX(pt.timestamp),
          y: rateToY(pt.rateErrorSecondsPerDay),
          isTick: pt.isTick,
        }));

        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(194, 120, 3, 0.22)';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);

        if (isSmoothed && points.length > 2) {
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

        ctx.lineWidth = 2.25;
        ctx.strokeStyle = '#b45309';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);

        if (isSmoothed && points.length > 2) {
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

        for (let i = 0; i < points.length; i++) {
          ctx.fillStyle = points[i].isTick ? '#d97706' : '#78350f';
          ctx.beginPath();
          ctx.arc(points[i].x, points[i].y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 4. Cursor point
      if (latest && visibleData.length > 0) {
        const lastX = timeToX(latest.timestamp);
        const lastY = rateToY(latest.rateErrorSecondsPerDay);

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
      }

      // 5. Probe Tooltip
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

      ctx.restore();

      // Ensure animation keeps looping while initializing or active
      if ((isRunning || isInitializing) && !isPaused) {
        animationId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [
    measurements,
    displayData,
    isSmoothed,
    timeWindow,
    yScaleMode,
    targetRate,
    autoLockedBounds,
    isPaused,
    isRunning,
    isInitializing,
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
    for (let i = 0; i < measurements.length; i++) {
      const diff = Math.abs(measurements[i].timestamp - hoverTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = measurements[i];
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
      {/* 1-Line Slim Header */}
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
      </div>

      {/* Main Body */}
      <div className="flex flex-col sm:flex-row items-stretch">
        {/* Canvas Viewport */}
        <div ref={containerRef} className="relative flex-1 h-[280px] sm:h-[305px] lg:h-[320px] bg-[#faf7f0]">
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="w-full h-full cursor-crosshair block"
          />

          {/* HTML Overlay: Initializing Audio State */}
          {isInitializing && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#faf7f0]/80 backdrop-blur-[2px] transition-all z-20">
              <div className="flex items-center gap-3 px-5 py-3.5 bg-white border-2 border-[#b45309] rounded-xl shadow-lg animate-pulse">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#b45309] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-[#b45309]"></span>
                </span>
                <div className="flex flex-col">
                  <span className="font-mono font-bold text-xs text-[#b45309] tracking-wider">
                    Initializing Audio Input
                  </span>
                  <span className="text-[11px] text-[#78716c]">
                    May God bless you...
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* HTML Overlay: Standby State */}
          {!isInitializing && !isRunning && measurements.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#faf7f0]/90 pointer-events-none z-10">
              <div className="flex flex-col items-center justify-center px-6 py-4 bg-white border border-[#ded5c5] rounded-xl shadow-md text-center max-w-sm">
                <span className="font-mono font-bold text-xs text-[#78350f] tracking-wider mb-1">
                  STANDBY
                </span>
                <span className="font-mono text-xs text-[#78716c]">
                  Click <b>Live Mic</b> or <b>Simulate</b> to graph
                </span>
              </div>
            </div>
          )}

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

        {/* Right-Docked Vertical Controls Strip */}
        <div className="w-full sm:w-36 lg:w-40 bg-[#fdfcf9] border-t sm:border-t-0 sm:border-l border-[#ded5c5] p-2 flex flex-col justify-between text-[11px] font-mono space-y-2">
          <div className="space-y-1.5">
            {/* Time Span Grid */}
            <div>
              <div className="grid grid-cols-4 sm:grid-cols-2 gap-1">
                {TIME_WINDOW_OPTIONS.map((opt) => (
                  <button
                    key={opt.sec}
                    type="button"
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

            {/* Filter & State Actions */}
            <div className="pt-1.5 border-t border-[#eee5d5] space-y-1">
              <button
                type="button"
                onClick={() => setIsSmoothed((prev) => !prev)}
                className={`w-full py-1 px-1.5 text-[10px] rounded transition text-center font-bold ${
                  isSmoothed
                    ? 'bg-[#78350f] text-white shadow-xs'
                    : 'bg-[#f5f0e4] text-stone-600 hover:bg-[#ede5d5] border border-[#e5decb]'
                }`}
              >
                Line smoothing
              </button>

              <div className="w-full pt-0.5">
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="w-full py-1 text-[10px] bg-[#f5f0e4] hover:bg-rose-50 text-stone-700 hover:text-rose-700 border border-[#e5decb] hover:border-rose-200 rounded transition flex items-center justify-center gap-1"
                  title="Clear graph trace"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Clear
                </button>
              </div>

            </div>
          </div>

          {/* Live Telemetry Stats */}
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
