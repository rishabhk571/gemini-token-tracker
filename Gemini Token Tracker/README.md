# Gemini Token Tracker

A Chrome extension that tracks real-time token usage while using Google Gemini (gemini.google.com). See exactly how many tokens your prompts, responses, thinking processes, images, and file attachments consume.

![Token Meter Preview](screenshot.png)

## Features

### Real-time Token Counting
- **Input tokens** — Your prompts and messages
- **Output tokens** — Gemini's responses
- **Thinking tokens** — Thought process in thinking mode
- **Draft tokens** — Text you're currently typing
- **Attachment tokens** — Images, documents, and files

### Token Sources
- Plain text conversations
- Image uploads (with dimension-based estimation)
- Document uploads (.docx via mammoth.js)
- Canvas/code editor content
- File attachments

### Smart Features
- **Plan Detection** — Automatically detects your tier (Free, Plus, Ultra)
- **Two Counting Modes**
  - Heuristic mode (default): Fast local estimation
  - API mode: Exact counts via Google's countTokens endpoint
- **Progress Tracking** — Visual progress bar showing context window usage
- **Alerts** — Warnings when approaching token limits

### Beautiful UI
- Floating action button (FAB) with frosted glass effect
- Draggable panel that snaps to screen corners
- Dark mode support (synced with Gemini's theme)
- Circular and linear progress indicators

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `Gemini Token Tracker_23rdMarch` folder

## Usage

### Basic Usage
1. Open Gemini Google (gemini.google.com)
2. The token meter appears as a floating button in the bottom-right corner
3. Click the button to expand and see detailed token breakdown
4. Drag the button to reposition it

### API Mode (Exact Counts)
1. Click the extension icon in Chrome toolbar
2. Enable "Use countTokens API"
3. Enter your Google AI Studio API key
4. Token counts will now be exact instead of estimated

### Getting an API Key
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create a new API key
3. Copy and paste into the extension settings

## Architecture

```
├── manifest.json          # Extension configuration
├── background.js         # Service worker (network interception)
├── content.js            # Content script (DOM scraping, token estimation)
├── ui.js                 # UI module (floating panel, FAB)
├── styles.css            # All styling
├── tokenizer.js          # Token estimation logic
├── canvas-bridge.js      # Canvas/Monaco editor bridge
├── popup.html/js         # Settings popup
└── mammoth.browser.min.js # .docx parsing library
```

### How It Works

1. **Content Script** scrapes the DOM for conversation text
2. **Local Estimation** calculates tokens using text length (1 token ≈ 4 chars)
3. **Background Worker** intercepts network requests to:
   - Detect file uploads
   - Parse streaming API responses for exact token counts
4. **UI Module** displays everything in a floating panel

## Permissions

This extension requires:
- `storage` — Save your API key and preferences
- `webRequest` — Intercept requests to Gemini API
- Access to `https://gemini.google.com/*`
- Access to `https://generativelanguage.googleapis.com/*`

## Files

| File | Description |
|------|-------------|
| `background.js` | Service worker for network interception and stream parsing |
| `content.js` | Main logic for DOM scraping, token estimation, file tracking |
| `ui.js` | UI rendering and interaction (FAB, panel, drag/drop) |
| `styles.css` | All styling including dark mode and animations |
| `popup.html/js` | Settings UI for API key and preferences |
| `tokenizer.js` | Token counting utilities |
| `canvas-bridge.js` | Bridge for canvas/code editor token counting |
| `mammoth.browser.min.js` | Library for extracting text from .docx files |

## Version History

- **v1.4.0** — Current release with frosted glass FAB, plan detection, thinking mode support

## License

MIT License

## Contributing

Issues and pull requests welcome!