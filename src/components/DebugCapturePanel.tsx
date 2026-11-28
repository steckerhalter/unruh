/**
 * Unruh - Debug capture panel
 *
 * Small floating drawer for the debug recorder (src/services/debugCapture.ts):
 * live counters, a sparkline of the last beats, and the transport controls
 * (start/stop, copy, download, clear). It deliberately shows *per-beat* values
 * — the medians on the main dashboard hide exactly the jitter this panel is
 * meant to expose.
 *
 * The panel polls the module state instead of subscribing: the recorder is fed
 * from the audio beat path and must not notify React on every beat.
 */

import React, { useEffect, useState } from 'react';
import { Bug, Copy, Download, Play, Square, Trash2, X } from 'lucide-react';
import {
  clearDebugCapture,
  downloadDebugLog,
  getDebugCaptureStats,
  getDebugJsonl,
  setDebugCaptureEnabled,
  setDebugEnvelopesEnabled,
  setDebugFullSnippetsEnabled,
  type DebugCaptureStats,
} from '../services/debugCapture';

interface Props {
  open: boolean;
  onClose: () => void;
}

const W = 264;
const H = 40;

function sparkPath(values: number[]): string {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  return vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * W;
      const y = H - ((v - min) / span) * (H - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export const DebugCapturePanel: React.FC<Props> = ({ open, onClose }) => {
  const [stats, setStats] = useState<DebugCaptureStats>(() => getDebugCaptureStats());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setStats(getDebugCaptureStats()), 250);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  const { config, sink, beats, pendingLines, pendingBytes, lastBeat, lastError } = stats;
  const recent = stats.recent.slice(-60);
  const snrDb =
    lastBeat?.peak != null && lastBeat.noise > 0
      ? 20 * Math.log10(lastBeat.peak / lastBeat.noise)
      : null;
  const intervals = recent.map((r) => r.dt ?? NaN);
  const lifts = recent.map((r) => r.lift);

  const sinkLabel = !config.enabled
    ? 'capture off'
    : sink === 'live'
      ? 'streaming → .unruh-debug/live.ndjson'
      : sink === 'buffering'
        ? 'buffer only (no dev sink — download to keep)'
        : 'starting…';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getDebugJsonl(200));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (not a secure context) */
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[300px] rounded-xl border border-[#ded5c5] bg-[#fdfcf9] shadow-xl">
      <div className="flex items-center justify-between border-b border-[#eee5d5] px-3 py-2">
        <span className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[#78350f]">
          <Bug size={12} /> Debug capture
        </span>
        <button
          onClick={onClose}
          title="Close"
          className="rounded p-0.5 text-stone-500 transition hover:bg-[#f5f0e4] hover:text-stone-800"
        >
          <X size={13} />
        </button>
      </div>

      <div className="space-y-2 px-3 py-2 font-mono text-[10px] text-stone-700">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              !config.enabled
                ? 'bg-stone-400'
                : sink === 'live'
                  ? 'bg-emerald-600'
                  : 'bg-amber-500'
            }`}
          />
          <span className="truncate text-stone-600" title={lastError ?? sinkLabel}>
            {sinkLabel}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1.5 tabular-nums">
          <div className="rounded border border-[#eee5d5] bg-white px-1.5 py-1">
            <div className="text-[9px] uppercase text-stone-500">beats</div>
            <div className="text-xs font-bold text-stone-800">{beats}</div>
          </div>
          <div className="rounded border border-[#eee5d5] bg-white px-1.5 py-1">
            <div className="text-[9px] uppercase text-stone-500">buffered</div>
            <div className="text-xs font-bold text-stone-800">{pendingLines}</div>
          </div>
          <div className="rounded border border-[#eee5d5] bg-white px-1.5 py-1">
            <div className="text-[9px] uppercase text-stone-500">size</div>
            <div className="text-xs font-bold text-stone-800">
              {pendingBytes > 1024 * 1024
                ? `${(pendingBytes / 1024 / 1024).toFixed(1)}M`
                : `${Math.round(pendingBytes / 1024)}K`}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px]">
          <span className="text-[9px] uppercase text-stone-500">SNR (peak/noise)</span>
          {snrDb === null ? (
            <span className="text-stone-400">—</span>
          ) : (
            <span
              className={`font-semibold ${
                snrDb >= 40 ? 'text-emerald-700' : snrDb >= 30 ? 'text-amber-700' : 'text-rose-700'
              }`}
              title="~30 dB means the input chain (ADC/preamp) limits the timing, not the app"
            >
              {snrDb.toFixed(1)} dB
            </span>
          )}
        </div>

        <div>
          <div className="mb-0.5 flex justify-between text-[9px] uppercase text-stone-500">
            <span>interval</span>
            <span>
              {lastBeat?.dt != null ? `${lastBeat.dt.toFixed(1)} ms` : '—'}
            </span>
          </div>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <path d={sparkPath(intervals)} fill="none" stroke="#b45309" strokeWidth={1.2} />
          </svg>
        </div>

        <div>
          <div className="mb-0.5 flex justify-between text-[9px] uppercase text-stone-500">
            <span>lift time</span>
            <span>
              {lastBeat ? `${lastBeat.lift.toFixed(1)} ms · ${lastBeat.amp}°` : '—'}
            </span>
          </div>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <path d={sparkPath(lifts)} fill="none" stroke="#059669" strokeWidth={1.2} />
          </svg>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setDebugCaptureEnabled(!config.enabled)}
            className={`flex flex-1 items-center justify-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold transition ${
              config.enabled
                ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
                : 'border-[#b45309] bg-[#f5f0e4] text-[#78350f] hover:bg-[#efe7d6]'
            }`}
          >
            {config.enabled ? <Square size={11} /> : <Play size={11} />}
            {config.enabled ? 'Stop' : 'Start'}
          </button>
          <button
            onClick={handleCopy}
            title="Copy the last 200 records as JSONL"
            className="flex items-center gap-1 rounded border border-[#ded5c5] bg-white px-2 py-1 text-[10px] text-stone-700 transition hover:border-[#b45309]"
          >
            <Copy size={11} /> {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={downloadDebugLog}
            title="Download the buffered records as JSONL"
            className="flex items-center gap-1 rounded border border-[#ded5c5] bg-white px-2 py-1 text-[10px] text-stone-700 transition hover:border-[#b45309]"
          >
            <Download size={11} /> Save
          </button>
          <button
            onClick={() => void clearDebugCapture()}
            title="Clear the buffer"
            className="rounded border border-[#ded5c5] bg-white px-2 py-1 text-[10px] text-stone-700 transition hover:border-rose-300 hover:text-rose-700"
          >
            <Trash2 size={11} />
          </button>
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-stone-600">
          <input
            type="checkbox"
            checked={config.envelopes}
            onChange={(e) => setDebugEnvelopesEnabled(e.target.checked)}
            className="accent-[#78350f]"
          />
          ~1 kHz envelopes (shows which burst was picked)
        </label>

        <label className="flex cursor-pointer items-start gap-1.5 text-[10px] text-stone-600">
          <input
            type="checkbox"
            checked={config.fullSnippets}
            onChange={(e) => setDebugFullSnippetsEnabled(e.target.checked)}
            className="mt-0.5 accent-[#78350f]"
          />
          <span>
            full 48 kHz snippets (~9 KB/beat, capped at {stats.maxFullSnippets})
            <span className="ml-1 text-stone-400">
              {config.fullSnippets ? `${stats.fullSnippets} stored` : ''}
            </span>
          </span>
        </label>
      </div>
    </div>
  );
};
