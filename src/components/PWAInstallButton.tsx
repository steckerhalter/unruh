import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Smartphone, X } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed standalone app, hide button
  if (isInstalled) {
    return null;
  }

  // Android / Chromium installation flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-bold rounded-lg bg-[#fef3c7] border border-[#fde68a] text-[#78350f] hover:bg-[#fde68a] transition shadow-xs"
        title="Install ChronoScope as native Android / Desktop app"
      >
        <Smartphone className="w-3.5 h-3.5 text-[#78350f]" />
        <span>Install App</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium rounded-lg bg-[#f5f0e4] border border-[#ded5c5] text-stone-700 hover:text-stone-900 transition"
        >
          <Smartphone className="w-3.5 h-3.5 text-[#78350f]" />
          <span>Add to iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 backdrop-blur-xs p-4 animate-fadeIn">
            <div className="w-full max-w-sm rounded-xl bg-white border border-[#ded5c5] p-5 shadow-2xl">
              <div className="flex items-center justify-between pb-2 border-b border-[#ded5c5]">
                <h3 className="text-sm font-semibold text-stone-900 font-display">Install on iPhone / iPad</h3>
                <button onClick={() => setShowIOSGuide(false)} className="text-stone-400 hover:text-stone-700">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-3 text-xs text-stone-600 font-mono leading-relaxed">
                1. Tap the <strong className="text-[#78350f]">Share</strong> icon in Safari toolbar.<br />
                2. Scroll down and tap <strong className="text-[#78350f]">Add to Home Screen</strong>.<br />
                3. ChronoScope will launch full-screen like a native app.
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-lg bg-[#78350f] hover:bg-[#5c2b0c] text-white py-1.5 text-xs font-mono font-bold transition shadow-xs"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
