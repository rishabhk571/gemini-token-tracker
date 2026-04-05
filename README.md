# Gemini Token Tracker

A multi-sensor token accounting system and state reconciliation engine for `gemini.google.com`. 

Unlike basic counters, this extension fuses multiple imperfect signals (DOM scraping, upload interception, and server metadata) into one stable output, designed to survive Gemini's rapid SPA churn and DOM instability.

## 🧠 System Architecture

The system operates as an aircraft using barometric, radar, and inertial estimates together. If one sensor drifts, the system survives by fusing sources via a priority ladder.

* **Service Worker (`background.js`):** Inspects network requests for upload detection and exact usage metadata via stream parsing.
* **Core Orchestrator (`content.js`):** Manages DOM scraping, SPA lifecycle transitions, plan-tier detection, and state reconciliation.
* **Counting Engine (`tokenizer.js`):** Dual-mode engine supporting heuristic natural language/code estimation and a definitive API-backed `countTokens` mode.
* **Page-Context Bridge (`canvas-bridge.js`):** Safely extracts Monaco internal models when Gemini's code-immersive panels are active.

## ⚡ Key Features

* **Multi-Source Fusion:** Prioritizes local tracked uploads over network fallbacks, using server totals as the absolute floor post-send.
* **Context Limit Awareness:** Automatically detects current Google AI plan tiers and updates tokenizer context limits (32k, 128k, 192k, 1M).
* **Rich Attachment Ingestion:** Supports `.docx` extraction (via Mammoth), image dimension estimation, and text file parsing directly in the browser.
* **Non-Intrusive UI:** Floating FAB with expandable diagnostic panel, persistent across SPA navigations.

## 🛠️ Installation (Developer Mode)

1. Clone this repository or download the ZIP.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and select the extension directory.
5. Navigate to `gemini.google.com` to see the tracker initialize.

## ⚠️ Privacy & Security Note

By default, token counting is done locally via heuristics. If **API Mode** is enabled in the extension settings, prompt text will be transmitted to the Google Generative Language API for exact token calculation.
