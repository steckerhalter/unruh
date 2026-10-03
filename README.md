# ⏱️ Unruh — Precision Watchmaker Timegrapher

Webapp: https://steckerhalter.github.io/unruh/

**Unruh** is an open-source, web-based mechanical watch timing and diagnostic tool. Designed for watchmakers, restorers, and horology enthusiasts, Unruh leverages high-sample-rate web audio processing to measure mechanical movement performance—including daily rate error ($\text{s/d}$), balance amplitude, beat error, and acoustic signature identification—directly from your browser using standard piezo acoustic sensors or high-sensitivity microphones.

---

## ✨ Features

- **📊 Live Rate Oscilloscope:** Real-time rate trend visualization equipped with continuous moving-average smoothing, customizable observation windows ($15\text{s}$ to $1\text{h}$), and dynamic 5-second scale auto-locking.
- **🎧 Acoustic DSP Engine:** Multi-stage signal filtering pipeline featuring a high-pass filter, 5 kHz bandpass isolation, dynamic noise gating, and adaptive threshold peak detection.
- **🔍 Movement Diagnostics:** Instant live calculations for:
  - **Daily Rate Error ($\text{s/d}$):** Instantaneous and windowed average rate drift.
  - **Beat Error ($\text{ms}$):** Symmetry calculation between tick and tock impulse intervals.
  - **Balance Amplitude ($^{\circ}$):** Lift-angle based calculation for balance wheel rotation.
- **🏷️ Acoustic ID & Auto-BPH Detection:** Frequency domain identification tailored for common Swiss, Japanese, and vintage calibers (e.g., ETA 2824-2, Sellita SW200, Miyota, Seiko).
- **🕹️ Real-Time Controls:** Interactive crosshair probe tooltips, graph pause/resume tracing, and single-click history clearing.

---

## 🛠 Audio DSP Default Configuration

Unruh utilizes a specialized Web Audio API signal processing pipeline tuned for steel-on-ruby watch escapement impacts:

| Parameter | Default Value | Description |
| :--- | :--- | :--- |
| `highPassCutoff` | `1000 Hz` | Eliminates low-frequency ambient rumble, AC hum, and desk vibration. |
| `bandPassFreq` | `5000 Hz` | Isolates the sharp acoustic resonance of pallet jewel impacts. |
| `sensitivityThreshold` | `0.08` | Base threshold floor for detecting low-amplitude vintage movements. |
| `autoThreshold` | `true` | Dynamic peak threshold tracking for automatic signal locking. |
| `lockoutRatio` | `0.55` | Refractory period to prevent hairspring and fork echo double-triggering. |
| `noiseGate` | `0.035` | Noise floor barrier to eliminate background hiss between beat impulses. |

---


## 🚀 Getting Started

This guide is for local installation and development. If you don't need that, you can use the online version directly in your browser:
https://steckerhalter.github.io/unruh/

### Prerequisites

- Node.js (v18.0.0 or higher)
- npm or yarn
- An external acoustic pickup (a piezo contact microphone clamped to the watch case is recommended for best results).

### Installation

1. **Clone the repository:**
   ` ` `bash
   git clone https://github.com/steckerhalter/unruh
   cd unruh
   ` ` `

2. **Install dependencies:**
   ` ` `bash
   npm install
   ` ` `

3. **Start the development server:**
   ` ` `bash
   npm run dev
   ` ` `

4. **Open in browser:**
   Navigate to `http://localhost:3000/unruh/` in a Chrome, Edge, or Firefox browser (Web Audio API permissions required).

---

## 💻 Usage Instructions

1. **Attach Microphone:** Clamp your piezo microphone firmly to the watch case, crown, or movement holder.
2. **Select Lift Angle:** Set the balance lift angle to match your watch caliber's specification (default is $52^{\circ}$).
3. **Start Live Mic:** Click **Live Mic** to initialize audio stream capture.
4. **Adjust Sensitivity:** If necessary, adjust the noise gate or threshold until distinct tick/tock peaks are registered without false triggers.
5. **Observe Trace:** Allow the rate oscilloscope 15–30 seconds to establish a stable rate trend line.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request for new caliber presets, acoustic filtering enhancements, or UI improvements.

1. Fork the Project
2. Create your branch (`git checkout -b branch`)
3. Commit your changes (`git commit -m 'dirty dozen optimization'`)
4. Push to the Branch (`git push origin branch`)
5. Open a Pull Request

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
