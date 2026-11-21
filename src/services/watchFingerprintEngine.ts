/**
 * Unruh - Watch Acoustic Fingerprinting & Identification Engine
 * Recognizes watch movements by their acoustic signature (BPH, escapement resonance,
 * impulse duration Delta-t, and harmonic spectrum).
 * Features Schmitt-trigger hysteresis to eliminate rapid jumping between Identified and Unknown,
 * rolling temporal smoothing across tick/tock cycles, and persistent tracking of previously graphed unknown watches.
 */

import {
  AcousticSignature,
  BphOption,
  FingerprintMatch,
  WatchAcousticProfile,
} from '../types/timegrapher';

const STORAGE_KEY = 'chronoscope_watch_profiles_v2';
const UNKNOWN_STORAGE_KEY = 'chronoscope_unknown_watches_v2';

/**
 * Confidence below which the app does not consider any watch to be on the
 * bench: while the Live Mic is on, the panel reports "No watch on the bench".
 */
export const LOCK_IN_THRESHOLD = 68;

export interface UnknownWatchRecord {
  id: string;
  label: string;
  bph: number;
  peakResonanceHz: number;
  deltaTImpulseMs: number;
  firstSeen: number;
  lastSeen: number;
  totalBeats: number;
  signature: AcousticSignature;
}

/**
 * Sound characteristics of a signature, computed from the 8-band spectral
 * profile so the panel can describe a watch by the character of its sound
 * (depth, brightness, focus) instead of raw numbers.
 *
 * - Depth: share of the sound's energy in the lower 4 of the 8 bands
 *   (deeper watch -> higher).
 * - Brightness: share of the energy in the upper 4 bands.
 * - Focus: how concentrated the sound is (1 = one dominant band, 0 = spread out),
 *   from the Shannon entropy of the normalized band distribution.
 */
export function soundCharacteristics(bands: number[] | undefined): { depth: number; brightness: number; focus: number } {
  const arr = (bands || []).slice(0, 8).map((b) => Math.max(0, b || 0));
  const sum = arr.reduce((a, b) => a + b, 0) || 1;
  const p = arr.map((b) => b / sum);
  const depth = (p[0] + p[1] + p[2] + p[3]) / 4;
  const brightness = (p[4] + p[5] + p[6] + p[7]) / 4;
  let entropy = 0;
  for (const pi of p) {
    if (pi > 0) entropy -= pi * Math.log2(pi);
  }
  const focus = Math.max(0, Math.min(1, 1 - entropy / Math.log2(8)));
  return { depth, brightness, focus };
}

const FINE_BANDS = 16;

export class WatchFingerprintEngine {
  private profiles: WatchAcousticProfile[] = [];
  private unknownWatches: Map<string, UnknownWatchRecord> = new Map();

  // Rolling exponential moving average filters to smooth single-beat micro-variations
  private runningBph: number = 21600;
  private runningResonance: number = 4500;
  private runningDeltaT: number = 6.5;
  private runningBands: number[] = [0.1, 0.2, 0.4, 0.8, 0.9, 0.6, 0.3, 0.1];
  private samplesProcessed: number = 0;

  // Schmitt-trigger hysteresis state machine:
  // LOCK_IN_THRESHOLD = 68% (confidence required to initially declare an identification)
  // DROPOUT_THRESHOLD = 48% (confidence below which an already identified watch will be released)
  // LOCK_IN_STREAK = 3 (evaluations needed to confirm match)
  // DROPOUT_STREAK = 12 (evaluations needed below threshold to declare unknown)
  private lockedProfile: WatchAcousticProfile | null = null;
  private lockedConfidence: number = 0;
  private candidateProfile: WatchAcousticProfile | null = null;
  private candidateStreak: number = 0;
  private dropoutStreak: number = 0;

  /** Rolling average of the fine bands. */
  private runningFineBands: number[] = new Array(FINE_BANDS).fill(0.1);
  /** Rolling average of the spectral centroid (Hz). */
  private runningCentroid = 4500;
  /** Rolling average of the spectral spread (Hz). */
  private runningSpread = 0;

  constructor() {
    this.loadProfiles();
    this.loadUnknownWatches();
  }

  private loadProfiles() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.profiles = JSON.parse(stored).map((p: WatchAcousticProfile) => this.migrateProfile(p));
      } else {
        // No background profiles: the app only knows watches the user
        // names via "Name Watch".
        this.profiles = [];
      }
    } catch {
      this.profiles = [];
    }
  }

  /**
   * Synthesize the finer-grained spectral fields (fineBands, centroid, spread)
   * for profiles registered before they existed: their old 8-band coarse
   * profile is doubled into a 16-band fine profile.
   */
  private migrateProfile(p: WatchAcousticProfile): WatchAcousticProfile {
    if (!p.signature.fineBands && Array.isArray(p.signature.spectralBands) && p.signature.spectralBands.length === 8) {
      const fineBands: number[] = new Array(FINE_BANDS).fill(0);
      for (let b = 0; b < 8; b++) {
        fineBands[2 * b] = p.signature.spectralBands[b];
        fineBands[2 * b + 1] = p.signature.spectralBands[b];
      }
      p.signature.fineBands = fineBands;
    }
    return p;
  }

  public saveProfiles() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profiles));
    } catch (e) {
      console.error('Failed to save watch profiles:', e);
    }
  }

  private loadUnknownWatches() {
    // Disabled by user request: the app must not create records in the
    // background — the "Graphed Unknowns" store is empty unless the user
    // names watches ("Name Watch"). Clear any stored records on load.
    this.unknownWatches.clear();
    try {
      localStorage.removeItem(UNKNOWN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  private saveUnknownWatches() {
    try {
      const arr = Array.from(this.unknownWatches.values());
      localStorage.setItem(UNKNOWN_STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {
      console.error('Failed to save unknown watches:', e);
    }
  }

  public getProfiles(): WatchAcousticProfile[] {
    return [...this.profiles];
  }

  public getUnknownWatches(): UnknownWatchRecord[] {
    return Array.from(this.unknownWatches.values());
  }

  /**
   * Extract acoustic signature from captured audio snippet and frequency data,
   * with multi-beat rolling exponential smoothing.
   */
  public extractSignature(
    snippet: Float32Array | undefined,
    sampleRate: number,
    bph: number,
    deltaTMs: number,
    frequencyData?: Uint8Array
  ): AcousticSignature {
    let rawResonance = 4500;
    const rawBands: number[] = [0.1, 0.2, 0.4, 0.8, 0.9, 0.6, 0.3, 0.1];
    const rawFineBands: number[] = new Array(FINE_BANDS).fill(0.1);
    let rawCentroid = 4500;
    let rawSpread = 0;

    if (frequencyData && frequencyData.length >= 64) {
      const totalBins = frequencyData.length;
      const binWidthHz = (sampleRate / 2) / totalBins;

      let maxBinVal = 0;
      let maxBinIdx = 0;
      for (let i = 0; i < totalBins; i++) {
        if (frequencyData[i] > maxBinVal) {
          maxBinVal = frequencyData[i];
          maxBinIdx = i;
        }
      }
      rawResonance = Math.round(maxBinIdx * binWidthHz);
      rawResonance = Math.max(1800, Math.min(7500, rawResonance));

      const bandSize = Math.floor(totalBins / 8);
      for (let b = 0; b < 8; b++) {
        let sum = 0;
        const start = b * bandSize;
        const end = Math.min(totalBins, start + bandSize);
        for (let j = start; j < end; j++) {
          sum += frequencyData[j];
        }
        rawBands[b] = Math.min(1.0, (sum / (end - start)) / 255);
      }

      // 16 fine bands (finer-grained energy profile — better watch differentiation)
      const fineSize = Math.floor(totalBins / FINE_BANDS);
      for (let b = 0; b < FINE_BANDS; b++) {
        let sum = 0;
        const start = b * fineSize;
        const end = Math.min(totalBins, start + fineSize);
        for (let j = start; j < end; j++) {
          sum += frequencyData[j];
        }
        rawFineBands[b] = Math.min(1.0, (sum / Math.max(1, end - start)) / 255);
      }

      // Spectral centroid + spread from the full FFT (energy-weighted)
      let centroidSum = 0;
      let centroidSqSum = 0;
      let energySum = 0;
      for (let i = 0; i < totalBins; i++) {
        const v = frequencyData[i];
        if (v <= 0) continue;
        const f = i * binWidthHz;
        centroidSum += v * f;
        centroidSqSum += v * f * f;
        energySum += v;
      }
      if (energySum > 0) {
        rawCentroid = centroidSum / energySum;
        rawSpread = Math.sqrt(Math.max(0, centroidSqSum / energySum - rawCentroid * rawCentroid));
      }
    }

    const rawDeltaT = Math.max(3.5, Math.min(12, deltaTMs || 6.5));

    // Rolling temporal integration across beats (cancels tick-vs-tock micro differences)
    if (this.samplesProcessed === 0) {
      this.runningBph = bph;
      this.runningResonance = rawResonance;
      this.runningDeltaT = rawDeltaT;
      this.runningBands = [...rawBands];
      this.runningFineBands = [...rawFineBands];
      this.runningCentroid = Math.round(rawCentroid);
      this.runningSpread = Math.round(rawSpread);
    } else {
      this.runningBph = bph;
      this.runningResonance = Math.round(this.runningResonance * 0.75 + rawResonance * 0.25);
      this.runningDeltaT = this.runningDeltaT * 0.75 + rawDeltaT * 0.25;
      for (let k = 0; k < 8; k++) {
        this.runningBands[k] = this.runningBands[k] * 0.8 + rawBands[k] * 0.2;
      }
      for (let k = 0; k < FINE_BANDS; k++) {
        this.runningFineBands[k] = this.runningFineBands[k] * 0.8 + rawFineBands[k] * 0.2;
      }
      this.runningCentroid = Math.round(this.runningCentroid * 0.75 + rawCentroid * 0.25);
      this.runningSpread = Math.round(this.runningSpread * 0.75 + rawSpread * 0.25);
    }
    this.samplesProcessed++;

    return {
      bph: this.runningBph,
      peakResonanceHz: this.runningResonance,
      deltaTImpulseMs: this.runningDeltaT,
      spectralBands: [...this.runningBands],
      fineBands: [...this.runningFineBands],
      spectralCentroidHz: this.runningCentroid,
      spectralSpreadHz: this.runningSpread,
      tickTockRatio: 1.0,
    };
  }

  /**
   * Match live acoustic signature against library of known watches
   * Uses two-threshold Schmitt trigger hysteresis to eliminate toggling between Identified & Unknown.
   */
  public matchSignature(sig: AcousticSignature): FingerprintMatch {
    let topProfile: WatchAcousticProfile | null = null;
    let topConfidence = 0;

    for (const profile of this.profiles) {
      const pSig = profile.signature;

      // 1. BPH Match weight: 45% (Primary invariant of a watch movement)
      let bphScore = 0;
      if (sig.bph === pSig.bph) {
        bphScore = 1.0;
      } else {
        const bphDiff = Math.abs(sig.bph - pSig.bph);
        bphScore = Math.max(0, 1 - bphDiff / 3600);
      }

      // 2. Impulse Delta-t Match weight: 25% (Balance diameter & lift angle characteristic)
      const deltaTDiff = Math.abs(sig.deltaTImpulseMs - pSig.deltaTImpulseMs);
      const deltaTScore = Math.max(0, 1 - deltaTDiff / 3.2);

      // 3. Peak Resonance Match weight: 15% (Pallet jewel striking resonance)
      const resDiff = Math.abs(sig.peakResonanceHz - pSig.peakResonanceHz);
      const resScore = Math.max(0, 1 - resDiff / 2200);

      // 4. Spectral Band Cosine Similarity: 15%
      let dotProd = 0;
      let magA = 0;
      let magB = 0;
      for (let k = 0; k < 8; k++) {
        const a = sig.spectralBands[k] || 0.1;
        const b = pSig.spectralBands[k] || 0.1;
        dotProd += a * b;
        magA += a * a;
        magB += b * b;
      }
      const spectralScore = dotProd / (Math.sqrt(magA) * Math.sqrt(magB) || 1);

      // 5. Fine Band Cosine Similarity (16 bands) — the finer-grained sound
      // profile differentiates similar watches. Falls back to the 8-band score
      // when either side lacks fine bands.
      let fineScore = spectralScore;
      if (sig.fineBands && pSig.fineBands && sig.fineBands.length === FINE_BANDS && pSig.fineBands.length === FINE_BANDS) {
        let dotF = 0, magAF = 0, magBF = 0;
        for (let k = 0; k < FINE_BANDS; k++) {
          const a = sig.fineBands[k] || 0.1;
          const b = pSig.fineBands[k] || 0.1;
          dotF += a * b;
          magAF += a * a;
          magBF += b * b;
        }
        fineScore = dotF / (Math.sqrt(magAF) * Math.sqrt(magBF) || 1);
      }

      // 6. Spectral centroid difference — brighter vs duller watches
      let centroidScore = 1;
      if (typeof sig.spectralCentroidHz === 'number' && typeof pSig.spectralCentroidHz === 'number') {
        const centroidDiff = Math.abs(sig.spectralCentroidHz - pSig.spectralCentroidHz);
        centroidScore = Math.max(0, 1 - centroidDiff / 3000);
      }

      // 7. Spectral spread difference — narrow vs wide spectra
      let spreadScore = 1;
      if (typeof sig.spectralSpreadHz === 'number' && typeof pSig.spectralSpreadHz === 'number') {
        const spreadDiff = Math.abs(sig.spectralSpreadHz - pSig.spectralSpreadHz);
        spreadScore = Math.max(0, 1 - spreadDiff / 4000);
      }

      // Total weighted confidence (0 - 100). The spectral bands — the watch's
      // actual sound — dominate; the fine bands + centroid + spread add resolution.
      const confidence = (bphScore * 0.22 + deltaTScore * 0.09 + resScore * 0.09 + spectralScore * 0.12 + fineScore * 0.28 + centroidScore * 0.10 + spreadScore * 0.10) * 100;

      if (confidence > topConfidence) {
        topConfidence = confidence;
        topProfile = profile;
      }
    }

    const DROPOUT_THRESHOLD = 48;   // Threshold below which identification is lost
    const LOCK_IN_STREAK = 3;       // 3 consecutive beats required to lock
    const DROPOUT_STREAK = 12;      // 12 consecutive dropped beats required to unlock (~3 sec)

    // State Machine with Hysteresis
    if (this.lockedProfile) {
      // Currently identified: check how the locked profile is scoring
      let lockedProfileScore = 0;
      if (topProfile && topProfile.id === this.lockedProfile.id) {
        lockedProfileScore = topConfidence;
      } else {
        // Calculate score specifically for the locked profile
        const pSig = this.lockedProfile.signature;
        const bphScore = sig.bph === pSig.bph ? 1.0 : Math.max(0, 1 - Math.abs(sig.bph - pSig.bph) / 3600);
        const deltaTScore = Math.max(0, 1 - Math.abs(sig.deltaTImpulseMs - pSig.deltaTImpulseMs) / 3.2);
        const resScore = Math.max(0, 1 - Math.abs(sig.peakResonanceHz - pSig.peakResonanceHz) / 2200);
        // Spectral (sound) score of the locked profile vs the live signature
        let specDot = 0, specMagA = 0, specMagB = 0;
        for (let k = 0; k < 8; k++) {
          const a = sig.spectralBands[k] || 0.1;
          const b = pSig.spectralBands[k] || 0.1;
          specDot += a * b;
          specMagA += a * a;
          specMagB += b * b;
        }
        const lockedSpecScore = specDot / (Math.sqrt(specMagA) * Math.sqrt(specMagB) || 1);
        // Fine bands + centroid (same resolution as the main match)
        let lockedFineScore = lockedSpecScore;
        if (sig.fineBands && pSig.fineBands && sig.fineBands.length === FINE_BANDS && pSig.fineBands.length === FINE_BANDS) {
          let dotF = 0, magAF = 0, magBF = 0;
          for (let k = 0; k < FINE_BANDS; k++) {
            const a = sig.fineBands[k] || 0.1;
            const b = pSig.fineBands[k] || 0.1;
            dotF += a * b;
            magAF += a * a;
            magBF += b * b;
          }
          lockedFineScore = dotF / (Math.sqrt(magAF) * Math.sqrt(magBF) || 1);
        }
        let lockedCentroidScore = 1;
        if (typeof sig.spectralCentroidHz === 'number' && typeof pSig.spectralCentroidHz === 'number') {
          const centroidDiff = Math.abs(sig.spectralCentroidHz - pSig.spectralCentroidHz);
          lockedCentroidScore = Math.max(0, 1 - centroidDiff / 3000);
        }
        let lockedSpreadScore = 1;
        if (typeof sig.spectralSpreadHz === 'number' && typeof pSig.spectralSpreadHz === 'number') {
          const spreadDiff = Math.abs(sig.spectralSpreadHz - pSig.spectralSpreadHz);
          lockedSpreadScore = Math.max(0, 1 - spreadDiff / 4000);
        }
        lockedProfileScore = (bphScore * 0.22 + deltaTScore * 0.09 + resScore * 0.09 + lockedSpecScore * 0.12 + lockedFineScore * 0.28 + lockedCentroidScore * 0.10 + lockedSpreadScore * 0.10) * 100;
      }

      // Check if a different profile is overwhelmingly matching (> 80% for multiple evaluations)
      if (topProfile && topProfile.id !== this.lockedProfile.id && topConfidence >= 80) {
        // A user-named watch holds its lock: the app doesn't switch away from a
        // named watch on its own — the user deletes the profile to release it.
        const holdUserLock = this.lockedProfile.userRegistered === true;
        if (!holdUserLock) {
          if (this.candidateProfile?.id === topProfile.id) {
            this.candidateStreak++;
            if (this.candidateStreak >= 4) {
              // Switch lock to the new profile
              this.lockedProfile = topProfile;
              this.lockedConfidence = topConfidence;
              this.candidateStreak = 0;
              this.dropoutStreak = 0;
            }
          } else {
            this.candidateProfile = topProfile;
            this.candidateStreak = 1;
          }
        }
      } else if (lockedProfileScore < DROPOUT_THRESHOLD) {
        this.dropoutStreak++;
        if (this.dropoutStreak >= DROPOUT_STREAK && this.lockedProfile.userRegistered !== true) {
          // Sustained loss of signal -> release lock back to unknown.
          // User-named watches are not released on dropout — the user
          // deletes the profile in the Library instead.
          this.lockedProfile = null;
          this.lockedConfidence = 0;
          this.dropoutStreak = 0;
        }
      } else {
        // Firmly locked: damp confidence smoothly so numbers don't jitter wildly
        this.dropoutStreak = 0;
        this.candidateStreak = 0;
        this.lockedConfidence = Math.round(this.lockedConfidence * 0.85 + Math.max(68, lockedProfileScore) * 0.15);
      }
    } else {
      // Currently unknown: check if top profile qualifies for lock-in
      if (topProfile && topConfidence >= LOCK_IN_THRESHOLD) {
        if (this.candidateProfile?.id === topProfile.id) {
          this.candidateStreak++;
          if (this.candidateStreak >= LOCK_IN_STREAK) {
            // Lock onto this watch!
            this.lockedProfile = topProfile;
            this.lockedConfidence = Math.round(topConfidence);
            this.candidateStreak = 0;
            this.dropoutStreak = 0;
          }
        } else {
          this.candidateProfile = topProfile;
          this.candidateStreak = 1;
        }
      } else {
        this.candidateStreak = 0;
      }
    }

    const isRecognized = this.lockedProfile !== null;

    // Unknown-watch recording is disabled by user request: the app must not
    // create anything in the background — profiles are only created when the
    // user names a watch ("Name Watch").
    const temporarySignatureId = isRecognized
      ? ''
      : 'Watch on the bench — use "+ Name Watch" to name it';

    return {
      matchedProfile: isRecognized ? this.lockedProfile : null,
      confidencePct: isRecognized ? this.lockedConfidence : Math.round(topConfidence),
      isUnknown: !isRecognized,
      liveMatch: topProfile ? { profile: topProfile, confidence: topConfidence } : null,
      temporarySignatureId,
      currentSignature: sig,
    };
  }

  /**
   * Save a newly identified watch (turns an unknown sound profile into a recognized watch)
   */
  public registerWatchProfile(
    name: string,
    movementCalibre: string,
    bph: BphOption,
    liftAngle: number,
    signature: AcousticSignature,
    notes?: string
  ): WatchAcousticProfile {
    const id = `profile_${Date.now()}_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const newProfile: WatchAcousticProfile = {
      id,
      name,
      movementCalibre,
      bph,
      liftAngle,
      targetRate: 0.0,
      signature: {
        ...signature,
        bph,
      },
      dateCreated: Date.now(),
      timesRecognized: 1,
      notes,
      userRegistered: true,
    };

    this.profiles.unshift(newProfile);
    this.saveProfiles();

    // Immediately lock on to this newly registered profile!
    this.lockedProfile = newProfile;
    this.lockedConfidence = 96;
    this.candidateStreak = 0;
    this.dropoutStreak = 0;

    return newProfile;
  }

  public deleteProfile(id: string) {
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.lockedProfile?.id === id) {
      this.lockedProfile = null;
    }
    this.saveProfiles();
  }

  public clearUnknownWatches() {
    this.unknownWatches.clear();
    this.saveUnknownWatches();
  }
}

export const globalWatchFingerprinter = new WatchFingerprintEngine();

// Dev affordance: expose the singleton for debugging from the page
// (e.g. `globalWatchFingerprinter.registerWatchProfile(...)` from the console).
if (typeof window !== 'undefined') {
  (window as any).__globalWatchFingerprinter = globalWatchFingerprinter;
}
