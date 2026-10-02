/**
 * ChronoScope - Watch Acoustic Fingerprinting & Identification Engine
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

// Seeded profiles including Eloga vintage watch requested by user
const INITIAL_PROFILES: WatchAcousticProfile[] = [
  {
    id: 'profile_eloga_vintage',
    name: 'Eloga Vintage (Swiss Lever)',
    movementCalibre: 'Felsa / AS 1130 Calibre',
    bph: 18000,
    liftAngle: 50,
    targetRate: 0.0,
    signature: {
      bph: 18000,
      peakResonanceHz: 4500,
      deltaTImpulseMs: 6.5,
      spectralBands: [0.15, 0.28, 0.48, 0.85, 0.92, 0.65, 0.35, 0.18],
      tickTockRatio: 1.0,
    },
    dateCreated: Date.now() - 86400000 * 10,
    timesRecognized: 4,
    notes: 'Classic vintage Eloga mechanical watch with 18,000 bph balance wheel and Swiss lever escapement.',
  },
  {
    id: 'profile_seiko_nh35',
    name: 'Seiko NH35 / 4R36',
    movementCalibre: 'Seiko Instruments NH35A',
    bph: 21600,
    liftAngle: 53,
    targetRate: 0.0,
    signature: {
      bph: 21600,
      peakResonanceHz: 4800,
      deltaTImpulseMs: 6.2,
      spectralBands: [0.08, 0.18, 0.40, 0.90, 0.88, 0.58, 0.28, 0.12],
      tickTockRatio: 1.0,
    },
    dateCreated: Date.now() - 86400000 * 8,
    timesRecognized: 8,
    notes: 'Modern 3 Hz robust Japanese workhorse with Diashock balance.',
  },
  {
    id: 'profile_eta_2824',
    name: 'ETA 2824-2 / Sellita SW200',
    movementCalibre: 'ETA 2824-2',
    bph: 28800,
    liftAngle: 50,
    targetRate: 0.0,
    signature: {
      bph: 28800,
      peakResonanceHz: 5100,
      deltaTImpulseMs: 5.4,
      spectralBands: [0.05, 0.15, 0.32, 0.78, 0.98, 0.72, 0.42, 0.21],
      tickTockRatio: 1.0,
    },
    dateCreated: Date.now() - 86400000 * 5,
    timesRecognized: 12,
    notes: 'High-beat 4 Hz Swiss workhorse with Novodiac / Incabloc shock protection.',
  },
  {
    id: 'profile_vintage_pocket',
    name: 'Vintage Pocket Watch (18,000 bph)',
    movementCalibre: 'Unitas 6497 / Waltham',
    bph: 18000,
    liftAngle: 44,
    targetRate: 0.0,
    signature: {
      bph: 18000,
      peakResonanceHz: 3600,
      deltaTImpulseMs: 8.2,
      spectralBands: [0.25, 0.45, 0.72, 0.90, 0.70, 0.45, 0.20, 0.08],
      tickTockRatio: 1.0,
    },
    dateCreated: Date.now() - 86400000 * 3,
    timesRecognized: 2,
    notes: 'Large diameter pocket watch balance with heavy screw rim and slow deep acoustic strike.',
  },
];

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

  constructor() {
    this.loadProfiles();
    this.loadUnknownWatches();
  }

  private loadProfiles() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.profiles = JSON.parse(stored);
      } else {
        this.profiles = INITIAL_PROFILES;
        this.saveProfiles();
      }
    } catch {
      this.profiles = INITIAL_PROFILES;
    }
  }

  public saveProfiles() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profiles));
    } catch (e) {
      console.error('Failed to save watch profiles:', e);
    }
  }

  private loadUnknownWatches() {
    try {
      const stored = localStorage.getItem(UNKNOWN_STORAGE_KEY);
      if (stored) {
        const arr: UnknownWatchRecord[] = JSON.parse(stored);
        this.unknownWatches.clear();
        for (const item of arr) {
          this.unknownWatches.set(item.id, item);
        }
      }
    } catch (e) {
      console.error('Failed to load unknown watches:', e);
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
    }

    const rawDeltaT = Math.max(3.5, Math.min(12, deltaTMs || 6.5));

    // Rolling temporal integration across beats (cancels tick-vs-tock micro differences)
    if (this.samplesProcessed === 0) {
      this.runningBph = bph;
      this.runningResonance = rawResonance;
      this.runningDeltaT = rawDeltaT;
      this.runningBands = [...rawBands];
    } else {
      this.runningBph = bph;
      this.runningResonance = Math.round(this.runningResonance * 0.75 + rawResonance * 0.25);
      this.runningDeltaT = this.runningDeltaT * 0.75 + rawDeltaT * 0.25;
      for (let k = 0; k < 8; k++) {
        this.runningBands[k] = this.runningBands[k] * 0.8 + rawBands[k] * 0.2;
      }
    }
    this.samplesProcessed++;

    return {
      bph: this.runningBph,
      peakResonanceHz: this.runningResonance,
      deltaTImpulseMs: this.runningDeltaT,
      spectralBands: [...this.runningBands],
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

      // Total weighted confidence (0 - 100)
      const confidence = (bphScore * 0.45 + deltaTScore * 0.25 + resScore * 0.15 + spectralScore * 0.15) * 100;

      if (confidence > topConfidence) {
        topConfidence = confidence;
        topProfile = profile;
      }
    }

    const LOCK_IN_THRESHOLD = 68;   // Threshold to declare identification
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
        lockedProfileScore = (bphScore * 0.45 + deltaTScore * 0.25 + resScore * 0.3) * 100;
      }

      // Check if a different profile is overwhelmingly matching (> 80% for multiple evaluations)
      if (topProfile && topProfile.id !== this.lockedProfile.id && topConfidence >= 80) {
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
      } else if (lockedProfileScore < DROPOUT_THRESHOLD) {
        this.dropoutStreak++;
        if (this.dropoutStreak >= DROPOUT_STREAK) {
          // Sustained loss of signal -> release lock back to unknown
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

    // Unknown Sound Profile Tracking (Persistent across sessions as requested by user)
    // Quantize signature into identifiable profile bucket: BPH + Resonance (~300Hz bucket) + Delta-T (~0.5ms bucket)
    const roundedRes = Math.round(sig.peakResonanceHz / 300) * 300;
    const roundedDeltaT = Math.round(sig.deltaTImpulseMs * 2) / 2;
    const unknownKey = `UNREG_${sig.bph}_${roundedRes}Hz_${roundedDeltaT}ms`;

    let unknownRecord = this.unknownWatches.get(unknownKey);
    if (!unknownRecord) {
      // Check if another unknown record has the same BPH and close resonance (< 400Hz)
      for (const [id, rec] of this.unknownWatches.entries()) {
        if (rec.bph === sig.bph && Math.abs(rec.peakResonanceHz - sig.peakResonanceHz) < 450) {
          unknownRecord = rec;
          break;
        }
      }
    }

    if (!unknownRecord) {
      const index = this.unknownWatches.size + 1;
      unknownRecord = {
        id: unknownKey,
        label: `Unknown Watch #${index} (${sig.bph.toLocaleString()} bph · ${roundedRes} Hz)`,
        bph: sig.bph,
        peakResonanceHz: roundedRes,
        deltaTImpulseMs: roundedDeltaT,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        totalBeats: 1,
        signature: sig,
      };
      this.unknownWatches.set(unknownKey, unknownRecord);
      this.saveUnknownWatches();
    } else {
      unknownRecord.lastSeen = Date.now();
      unknownRecord.totalBeats++;
      if (unknownRecord.totalBeats % 50 === 0) {
        this.saveUnknownWatches();
      }
    }

    return {
      matchedProfile: isRecognized ? this.lockedProfile : null,
      confidencePct: isRecognized ? this.lockedConfidence : Math.round(topConfidence),
      isUnknown: !isRecognized,
      temporarySignatureId: unknownRecord.label,
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
