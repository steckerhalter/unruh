/**
 * Unruh - 6-Position Horological Multi-Positional Variance Tester
 * Allows testing watches in CH, CD, 6H, 9H, 3H, 12H to measure isochronism and balance poising error.
 * Styled in warm creamy horological bench aesthetic with yellow/brown/khaki accents.
 */

import React, { useState } from 'react';
import { WatchPositionCode, WatchPositionRecord, BeatMeasurement } from '../types/timegrapher';
import { Compass, CheckCircle2, Copy, RotateCcw } from 'lucide-react';

interface Props {
  latestBeat: BeatMeasurement | null;
  recentMeasurements: BeatMeasurement[];
}

const POSITIONS: { code: WatchPositionCode; label: string; description: string }[] = [
  { code: 'CH', label: 'Dial Up (CH)', description: 'Horizontal (Cadran Haut)' },
  { code: 'CD', label: 'Dial Down (CD)', description: 'Horizontal (Cadran Bas)' },
  { code: '6H', label: 'Crown Down (6H)', description: 'Vertical (Normal wrist hanging)' },
  { code: '9H', label: 'Crown Left (9H)', description: 'Vertical (Typical desk typing)' },
  { code: '3H', label: 'Crown Up (3H)', description: 'Vertical (Arm inverted)' },
  { code: '12H', label: 'Crown Right (12H)', description: 'Vertical (Driving orientation)' },
];

export const PositionTester: React.FC<Props> = ({ latestBeat, recentMeasurements }) => {
  const [records, setRecords] = useState<Record<WatchPositionCode, WatchPositionRecord | null>>({
    CH: null,
    CD: null,
    '6H': null,
    '9H': null,
    '3H': null,
    '12H': null,
  });

  const [copied, setCopied] = useState(false);

  const captureCurrentPosition = (code: WatchPositionCode, label: string) => {
    const sampleSize = Math.min(25, recentMeasurements.length);
    const sample = recentMeasurements.slice(-sampleSize);

    if (sample.length === 0 && !latestBeat) return;

    let sumRate = 0;
    let sumAmp = 0;
    let sumBeatErr = 0;

    if (sample.length > 0) {
      for (const m of sample) {
        sumRate += m.rateErrorSecondsPerDay;
        sumAmp += m.amplitudeDeg;
        sumBeatErr += m.beatErrorMs;
      }
      setRecords((prev) => ({
        ...prev,
        [code]: {
          code,
          label,
          avgRate: sumRate / sample.length,
          avgAmplitude: Math.round(sumAmp / sample.length),
          avgBeatError: sumBeatErr / sample.length,
          samplesCount: sample.length,
          timestamp: Date.now(),
        },
      }));
    } else if (latestBeat) {
      setRecords((prev) => ({
        ...prev,
        [code]: {
          code,
          label,
          avgRate: latestBeat.rateErrorSecondsPerDay,
          avgAmplitude: latestBeat.amplitudeDeg,
          avgBeatError: latestBeat.beatErrorMs,
          samplesCount: 1,
          timestamp: Date.now(),
        },
      }));
    }
  };

  const recordedList = Object.values(records).filter((r): r is WatchPositionRecord => r !== null);

  // Compute Delta between max and min rate
  let deltaRate = 0;
  let avgAllRate = 0;
  if (recordedList.length >= 2) {
    const rates = recordedList.map((r) => r.avgRate);
    deltaRate = Math.max(...rates) - Math.min(...rates);
    avgAllRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  }

  const handleCopyReport = () => {
    let report = '--- CHRONOSCOPE 6-POSITION TIMING REPORT ---\n';
    POSITIONS.forEach((pos) => {
      const rec = records[pos.code];
      if (rec) {
        const sign = rec.avgRate >= 0 ? '+' : '';
        report += `${rec.label.padEnd(18)}: Rate ${sign}${rec.avgRate.toFixed(1)} s/d | Amp ${rec.avgAmplitude}° | BeatErr ${rec.avgBeatError.toFixed(1)}ms\n`;
      } else {
        report += `${pos.label.padEnd(18)}: [Not Tested]\n`;
      }
    });
    if (recordedList.length >= 2) {
      report += `-------------------------------------------\n`;
      report += `Max Positional Delta (Δ): ${deltaRate.toFixed(1)} s/d\n`;
      report += `Mean Multi-Positional Rate: ${avgAllRate >= 0 ? '+' : ''}${avgAllRate.toFixed(1)} s/d\n`;
    }

    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleReset = () => {
    setRecords({
      CH: null,
      CD: null,
      '6H': null,
      '9H': null,
      '3H': null,
      '12H': null,
    });
  };

  return (
    <div className="bg-white border border-[#ded5c5] rounded-xl p-3 shadow-xs space-y-2.5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eee5d5] pb-2">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-[#78350f]" />
          <div>
            <h3 className="font-semibold text-stone-900 font-display text-xs">
              6-POSITION HOROLOGICAL VARIANCE TESTER
            </h3>
            <p className="text-[10px] text-stone-500 font-mono">
              Captures positional delta (Δ) to evaluate balance poising error and isochronism
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {recordedList.length > 0 && (
            <>
              <button
                onClick={handleCopyReport}
                className="flex items-center gap-1 px-2 py-0.5 text-xs font-mono rounded bg-[#fef3c7] border border-[#fde68a] text-[#78350f] hover:bg-[#fde68a] transition font-bold"
              >
                <Copy className="w-3 h-3" />
                <span>{copied ? 'Copied!' : 'Copy Report'}</span>
              </button>
              <button
                onClick={handleReset}
                className="p-1 rounded text-stone-500 hover:text-rose-600 transition"
                title="Reset all positions"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 6-Position Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        {POSITIONS.map((pos) => {
          const rec = records[pos.code];
          return (
            <div
              key={pos.code}
              className={`p-2.5 rounded-lg border transition flex flex-col justify-between space-y-1.5 ${
                rec ? 'bg-[#faf7f0] border-[#ded5c5]' : 'bg-white border-[#eee5d5]'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold text-stone-900 text-xs font-mono flex items-center gap-1.5">
                    {pos.label}
                    {rec && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                  </div>
                  <div className="text-[10px] text-stone-500 font-mono">{pos.description}</div>
                </div>

                <button
                  onClick={() => captureCurrentPosition(pos.code, pos.label)}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-[#fef3c7] text-[#78350f] hover:bg-[#fde68a] border border-[#fde68a] transition font-bold"
                >
                  {rec ? 'Re-Test' : 'Record'}
                </button>
              </div>

              {rec ? (
                <div className="grid grid-cols-3 gap-1 pt-1.5 border-t border-[#ded5c5] text-center font-mono">
                  <div>
                    <div className="text-[9px] text-stone-500 uppercase">Rate</div>
                    <div className={`text-xs font-bold ${rec.avgRate >= 0 ? 'text-[#92400e]' : 'text-rose-700'}`}>
                      {rec.avgRate >= 0 ? '+' : ''}
                      {rec.avgRate.toFixed(1)} s/d
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-stone-500 uppercase">Amp</div>
                    <div className="text-xs font-bold text-stone-900">{rec.avgAmplitude}°</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-stone-500 uppercase">Beat Err</div>
                    <div className="text-xs font-bold text-stone-800">{rec.avgBeatError.toFixed(1)}ms</div>
                  </div>
                </div>
              ) : (
                <div className="py-1 text-center text-[10px] text-stone-400 font-mono">
                  Not tested yet
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary Footer Bar */}
      {recordedList.length >= 2 && (
        <div className="p-2 bg-[#faf7f0] rounded-lg border border-[#ded5c5] flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div>
            <span className="text-stone-500">Max Positional Delta (Δ):</span>{' '}
            <strong className={`text-xs ${deltaRate <= 10 ? 'text-emerald-700' : deltaRate <= 20 ? 'text-[#92400e]' : 'text-rose-700'}`}>
              {deltaRate.toFixed(1)} s/d
            </strong>{' '}
            <span className="text-[10px] text-stone-500">
              ({deltaRate <= 10 ? 'Chronometer poise' : deltaRate <= 20 ? 'Good factory poise' : 'Balance poise error'})
            </span>
          </div>

          <div>
            <span className="text-stone-500">Mean 6-Pos Rate:</span>{' '}
            <strong className={avgAllRate >= 0 ? 'text-[#92400e]' : 'text-rose-700'}>
              {avgAllRate >= 0 ? '+' : ''}
              {avgAllRate.toFixed(1)} s/d
            </strong>
          </div>
        </div>
      )}
    </div>
  );
};
