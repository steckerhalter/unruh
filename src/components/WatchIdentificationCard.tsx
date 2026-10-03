/**
 * Unruh - Acoustic Watch Identification & Sound Profile Card
 * Recognizes watch movements (e.g. Eloga, Seiko, ETA) by their acoustic sound signature.
 * Ultra-condensed in height with a warm yellow/brown/khaki horological aesthetic.
 */

import React, { useState } from 'react';
import {
  AcousticSignature,
  BphOption,
  FingerprintMatch,
  WatchAcousticProfile,
} from '../types/timegrapher';
import { globalWatchFingerprinter } from '../services/watchFingerprintEngine';
import {
  Sparkles,
  CheckCircle2,
  Plus,
  BookOpen,
  Volume2,
  Trash2,
  X,
  Check,
  History
} from 'lucide-react';

interface Props {
  match: FingerprintMatch | null;
  onApplyProfile: (profile: WatchAcousticProfile) => void;
  compact?: boolean;
}

export const WatchIdentificationCard: React.FC<Props> = ({ match, onApplyProfile, compact = false }) => {
  const [isNamingModalOpen, setIsNamingModalOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [libraryTab, setLibraryTab] = useState<'profiles' | 'unknowns'>('profiles');
  const [watchName, setWatchName] = useState('');
  const [calibreName, setCalibreName] = useState('');
  const [notes, setNotes] = useState('');

  const profiles = globalWatchFingerprinter.getProfiles();
  const unknownWatches = globalWatchFingerprinter.getUnknownWatches();

  const handleOpenNamingModal = () => {
    if (!watchName) {
      if (match?.currentSignature.bph === 18000) {
        setWatchName('Eloga Vintage (Swiss Lever)');
        setCalibreName('Felsa / AS 1130');
      } else {
        setWatchName(match?.temporarySignatureId || 'Custom Mechanical Watch');
      }
    }
    setIsNamingModalOpen(true);
  };

  const handleSaveWatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!watchName.trim() || !match) return;

    const bph = (match.currentSignature.bph as BphOption) || 21600;
    const newProfile = globalWatchFingerprinter.registerWatchProfile(
      watchName.trim(),
      calibreName.trim() || 'Custom Movement',
      bph,
      52,
      match.currentSignature,
      notes.trim()
    );

    setIsNamingModalOpen(false);
    setWatchName('');
    setCalibreName('');
    setNotes('');
    onApplyProfile(newProfile);
  };

  const handleDeleteProfile = (id: string) => {
    globalWatchFingerprinter.deleteProfile(id);
  };

  const matched = match?.matchedProfile;
  const isIdentified = match && !match.isUnknown && matched;

  return (
    <div className="bg-white border border-[#ded5c5] rounded-xl p-2.5 shadow-xs space-y-1.5">
      {/* Line 1: Identity status + Watch Name + Action */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-[#b45309] shrink-0" />
          <span className="text-[10px] uppercase font-mono text-stone-500 font-semibold tracking-wider">Acoustic ID:</span>
          {isIdentified ? (
            <div className="flex items-center gap-1 truncate">
              <span className="font-bold text-xs text-[#78350f] truncate font-display">
                {matched.name}
              </span>
              {matched.movementCalibre && (
                <span className="text-[10px] font-mono text-stone-400 hidden xl:inline">
                  ({matched.movementCalibre})
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-stone-800 font-medium truncate font-mono">
              {match ? match.temporarySignatureId : 'Analyzing clicks...'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isIdentified ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#fef3c7] text-[#78350f] border border-[#fde68a] flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-[#78350f]" />
              {match.confidencePct}%
            </span>
          ) : (
            <button
              onClick={handleOpenNamingModal}
              className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-[#fef3c7] text-[#78350f] border border-[#fde68a] hover:bg-[#fde68a] transition"
            >
              + Name Watch
            </button>
          )}

          <button
            onClick={() => setIsLibraryOpen(true)}
            className="p-1 rounded text-stone-500 hover:text-stone-900 hover:bg-[#f5f0e4] transition"
            title={`View Watch Library (${profiles.length} profiles)`}
          >
            <BookOpen className="w-3.5 h-3.5 text-[#78350f]" />
          </button>
        </div>
      </div>

      {/* Line 2: Compact Parameter Bar */}
      {match && (
        <div className="flex items-center justify-between text-[10px] font-mono text-stone-600 bg-[#faf7f0] px-2 py-1 rounded border border-[#eee5d5]">
          <div className="flex items-center gap-2">
            <span>BPH: <strong className="text-[#78350f]">{match.currentSignature.bph.toLocaleString()}</strong></span>
            <span className="text-stone-300">·</span>
            <span>Resonance: <strong className="text-stone-800">{match.currentSignature.peakResonanceHz}Hz</strong></span>
            <span className="text-stone-300">·</span>
            <span>Δt: <strong className="text-stone-800">{match.currentSignature.deltaTImpulseMs.toFixed(1)}ms</strong></span>
          </div>

          {isIdentified && (
            <button
              onClick={() => onApplyProfile(matched)}
              className="text-[10px] text-[#78350f] font-bold underline hover:text-[#5c2b0c] transition ml-1"
            >
              Apply {matched.liftAngle}°
            </button>
          )}
        </div>
      )}

      {/* Modal: Name & Register Watch Profile */}
      {isNamingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white border border-[#ded5c5] rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-[#faf7f0] border-b border-[#ded5c5]">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#78350f]" />
                <h4 className="font-semibold text-stone-900 font-display text-sm">
                  Register Acoustic Watch Profile
                </h4>
              </div>
              <button
                onClick={() => setIsNamingModalOpen(false)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveWatch} className="p-4 space-y-3">
              <p className="text-xs text-stone-600 font-mono">
                Give this watch a name (e.g. <em>Eloga Vintage</em>, <em>Seiko NH35</em>).
                Unruh will save its acoustic resonance and automatically recognize it in future sessions!
              </p>

              <div className="space-y-1">
                <label className="text-xs font-mono text-stone-800 font-semibold">
                  Watch Brand / Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Eloga Vintage Mechanical"
                  value={watchName}
                  onChange={(e) => setWatchName(e.target.value)}
                  className="w-full bg-[#fdfcf9] border border-[#d6ccbb] rounded px-3 py-1.5 text-xs font-mono text-stone-900 focus:outline-none focus:border-[#78350f]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-stone-700">
                  Movement / Calibre (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Felsa 1130 / AS 1130"
                  value={calibreName}
                  onChange={(e) => setCalibreName(e.target.value)}
                  className="w-full bg-[#fdfcf9] border border-[#d6ccbb] rounded px-3 py-1.5 text-xs font-mono text-stone-900 focus:outline-none focus:border-[#78350f]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-stone-700">Notes / Target Spec</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Regulated after cleaning; 50° lift angle."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-[#fdfcf9] border border-[#d6ccbb] rounded px-3 py-1.5 text-xs font-mono text-stone-900 focus:outline-none focus:border-[#78350f]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#ded5c5]">
                <button
                  type="button"
                  onClick={() => setIsNamingModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-mono text-stone-600 hover:text-stone-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-mono font-bold bg-[#78350f] text-white hover:bg-[#5c2b0c] rounded shadow-xs"
                >
                  Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Library of Stored Watch Profiles */}
      {isLibraryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-xl bg-white border border-[#ded5c5] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-5 py-3.5 bg-[#faf7f0] border-b border-[#ded5c5]">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[#78350f]" />
                <h4 className="font-semibold text-stone-900 font-display text-sm">
                  Watch Acoustic Fingerprint Library
                </h4>
              </div>
              <button
                onClick={() => setIsLibraryOpen(false)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Library Tabs */}
            <div className="flex items-center border-b border-[#ded5c5] bg-[#faf7f0] px-4 text-xs font-mono">
              <button
                onClick={() => setLibraryTab('profiles')}
                className={`py-2 px-3 border-b-2 font-medium transition ${
                  libraryTab === 'profiles'
                    ? 'border-[#78350f] text-[#78350f] font-bold'
                    : 'border-transparent text-stone-600 hover:text-stone-900'
                }`}
              >
                Known Watches ({profiles.length})
              </button>
              <button
                onClick={() => setLibraryTab('unknowns')}
                className={`py-2 px-3 border-b-2 font-medium transition flex items-center gap-1.5 ${
                  libraryTab === 'unknowns'
                    ? 'border-[#78350f] text-[#78350f] font-bold'
                    : 'border-transparent text-stone-600 hover:text-stone-900'
                }`}
              >
                <History className="w-3 h-3" />
                Graphed Unknowns ({unknownWatches.length})
              </button>
            </div>

            <div className="p-4 space-y-2.5 overflow-y-auto flex-1">
              {libraryTab === 'profiles' ? (
                profiles.length === 0 ? (
                  <div className="text-center py-6 text-stone-500 font-mono text-xs">
                    No watch profiles registered yet. Place a watch under the mic and click &ldquo;Name Watch&rdquo;.
                  </div>
                ) : (
                  profiles.map((p) => (
                    <div
                      key={p.id}
                      className="p-2.5 bg-[#fdfcf9] border border-[#ded5c5] rounded-lg flex items-center justify-between gap-3 hover:border-stone-400 transition"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-stone-900 text-xs font-mono">
                            {p.name}
                          </span>
                          {p.movementCalibre && (
                            <span className="text-[10px] text-stone-500 font-mono">
                              · {p.movementCalibre}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-stone-600 flex items-center gap-2">
                          <span>BPH: <strong className="text-[#78350f]">{p.bph.toLocaleString()}</strong></span>
                          <span>·</span>
                          <span>Lift: <strong>{p.liftAngle}°</strong></span>
                          <span>·</span>
                          <span>Resonance: <strong>{p.signature.peakResonanceHz} Hz</strong></span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            onApplyProfile(p);
                            setIsLibraryOpen(false);
                          }}
                          className="px-2.5 py-1 text-xs font-mono bg-[#fef3c7] border border-[#fde68a] text-[#78350f] font-bold rounded hover:bg-[#fde68a] transition"
                        >
                          Apply
                        </button>
                        <button
                          onClick={() => handleDeleteProfile(p.id)}
                          className="p-1 text-stone-400 hover:text-rose-600 transition"
                          title="Delete profile"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )
              ) : (
                unknownWatches.length === 0 ? (
                  <div className="text-center py-6 text-stone-500 font-mono text-xs">
                    No unknown watches graphed yet. As you test uncatalogued watches, their acoustic signatures will be saved here so you can recognize and name them later!
                  </div>
                ) : (
                  unknownWatches.map((u) => (
                    <div
                      key={u.id}
                      className="p-2.5 bg-[#fdfcf9] border border-[#ded5c5] rounded-lg flex items-center justify-between gap-3 hover:border-stone-400 transition"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[#78350f] text-xs font-mono">
                            {u.label}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-stone-600 flex items-center gap-2">
                          <span>BPH: <strong className="text-[#78350f]">{u.bph.toLocaleString()}</strong></span>
                          <span>·</span>
                          <span>Resonance: <strong>{u.peakResonanceHz} Hz</strong></span>
                          <span>·</span>
                          <span>Beats tracked: <strong className="text-stone-800">{u.totalBeats}</strong></span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setWatchName(u.label.replace('Unknown Watch', 'Vintage Watch'));
                          setIsNamingModalOpen(true);
                          setIsLibraryOpen(false);
                        }}
                        className="px-2.5 py-1 text-xs font-mono bg-[#fef3c7] border border-[#fde68a] text-[#78350f] font-bold rounded hover:bg-[#fde68a] transition whitespace-nowrap"
                      >
                        Name Watch
                      </button>
                    </div>
                  ))
                )
              )}
            </div>

            <div className="px-5 py-3 bg-[#faf7f0] border-t border-[#ded5c5] text-right">
              <button
                onClick={() => setIsLibraryOpen(false)}
                className="px-4 py-1.5 text-xs font-mono bg-[#f5f0e4] text-stone-700 hover:text-stone-900 border border-[#ded5c5] rounded transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
