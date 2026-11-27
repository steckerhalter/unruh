#!/usr/bin/env python3
"""Generate synthetic escapement recordings used to regression-test the
beat detector (rate / beat error / pulse timing) without a watch on the bench.

Each file is 20 s, mono, 48 kHz, 16-bit PCM and encodes an 18,000 bph
(200 ms half period) escapement with a known 1.5 ms beat error.

Usage:
    python3 generate.py            # writes the .wav files next to this script

To test the app, copy a file into public/recordings/ and select it in the
Simulator panel (Source: Recording). Expected results are in README.md.
"""

import os
import wave

import numpy as np

SR = 48000
DURATION_S = 20.0
HALF_PERIOD_MS = 200.0  # 18,000 bph
NOISE = 0.008


def pulse(buf: np.ndarray, t_s: float, amp: float, freq: float, decay: float,
          length_s: float = 0.015) -> None:
    """Add one damped sine impact at time t_s (seconds)."""
    n = int(length_s * SR)
    i0 = int(t_s * SR)
    if i0 < 0 or i0 >= len(buf):
        return
    n = min(n, len(buf) - i0)
    t = np.arange(n) / SR
    buf[i0:i0 + n] += amp * np.sin(2 * np.pi * freq * t) * np.exp(-decay * t)


def make(name: str, beat_error_ms: float = 1.5, mid_click_amp: float = 0.0,
         mid_click_at_ms: float = 100.0, bank_offset_ms: float = 0.0,
         first_amp: float = 0.18, seed: int = 42) -> None:
    rng = np.random.default_rng(seed)
    buf = rng.normal(0, NOISE, int(DURATION_S * SR)).astype(np.float64)

    short = HALF_PERIOD_MS - beat_error_ms
    long = HALF_PERIOD_MS + beat_error_ms
    t_ms = 500.0
    side = 0

    while t_ms < DURATION_S * 1000 - 50:
        t_s = t_ms / 1000.0
        pulse(buf, t_s, first_amp, 4800, 900)              # unlocking (quiet, precise)
        pulse(buf, t_s + 0.0025, 0.10, 3900, 700)          # impulse
        # Banking (loud). `bank_offset_ms` delays it on one side only, which
        # simulates an acoustic sub-event offset that must not be mistaken
        # for beat error.
        banking = 0.005 + (bank_offset_ms / 1000.0 if side == 1 else 0.0)
        pulse(buf, t_s + banking, 0.55, 5200, 1200)
        if mid_click_amp:
            # Extra impact between beats (pin-lever / overbanking-like).
            pulse(buf, t_s + mid_click_at_ms / 1000.0, mid_click_amp, 5000, 1100)

        t_ms += short if side == 0 else long
        side ^= 1

    data = (np.clip(buf, -1, 1) * 32767).astype(np.int16)
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print("wrote", path)


if __name__ == "__main__":
    make("TEST 18000 clean lever (1.5ms).wav")
    make("TEST 18000 pinlever midclick.wav", mid_click_amp=0.22)
    make("TEST 18000 loud midclick 100.wav", mid_click_amp=0.90, mid_click_at_ms=100)
    make("TEST 18000 loud midclick 90.wav", mid_click_amp=0.90, mid_click_at_ms=90)
    make("TEST 18000 bank offset.wav", bank_offset_ms=10.0)
