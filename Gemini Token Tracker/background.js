/**
 * background.js  v1.4  (Service Worker)
 *
 * Two responsibilities:
 *
 *   A. File upload detection (unchanged from v1.3)
 *      Intercepts large binary POST bodies, sends GTM_FILE_UPLOAD_DETECTED
 *      to content.js with raw byte count for fallback estimation.
 *
 *   B. Response stream parsing (NEW — Thinking mode fix)
 *      Gemini's API returns a streaming JSON payload that includes
 *      usageMetadata at the end of the stream:
 *
 *        {
 *          "usageMetadata": {
 *            "promptTokenCount":      1234,
 *            "candidatesTokenCount":  567,
 *            "totalTokenCount":       1801,
 *            "thoughtsTokenCount":    890    ← Thinking mode only
 *          }
 *        }
 *
 *      We use chrome.webRequest.onBeforeRequest with a StreamFilter to tap
 *      into the response body bytes, accumulate them, then parse the JSON
 *      and forward the exact counts to content.js via GTM_SERVER_TOKENS.
 *
 *      Note: StreamFilter is available in MV3 service workers via
 *      chrome.declarativeNetRequest or chrome.webRequest — we use the latter
 *      since we already have the webRequest permission.
 *
 * Messages sent to content.js:
 *   GTM_FILE_UPLOAD_DETECTED  { rawBytes, mimeHint, url }
 *   GTM_SERVER_TOKENS         { totalTokens, thoughtTokens, promptTokens, url }
 */

'use strict';

const GEMINI_PATTERNS = ['https://gemini.google.com/*'];
const MIN_BODY_BYTES  = 2048;
const MIN_BASE64_DATA_CHARS = 128;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Analyse ALL raw chunks (not just the first 512 bytes) to determine whether
 * this POST body contains an embedded file.
 *
 * Gemini wraps uploaded files as base64 inside JSON:
 *   {"contents":[{"parts":[{"inlineData":{"mimeType":"...","data":"<base64>"}},...
 *
 * The JSON wrapper makes the first bytes look like a plain text request.
 * We must scan a larger slice — up to 4 KB — and check for file-embedding
 * keys BEFORE checking for generic JSON keys.
 *
 * Return values:
 *   'file-in-json'  — JSON body that embeds a file via inlineData / fileData
 *   'binary'        — raw binary (direct ZIP/PDF upload, not base64-wrapped)
 *   'text-only'     — plain text prompt, no file content
 *   'unknown'       — couldn't determine
 */
function classifyPayload(rawChunks) {
  if (!rawChunks || !rawChunks.length) return 'unknown';
  try {
    // Decode up to 4 KB across the first few chunks for reliable detection
    let bytesBudget = 4096;
    let snippet     = '';
    for (const chunk of rawChunks) {
      if (!chunk.bytes || bytesBudget <= 0) break;
      const sliceLen = Math.min(chunk.bytes.byteLength, bytesBudget);
      const slice    = chunk.bytes.slice(0, sliceLen);
      snippet       += new TextDecoder('utf-8', { fatal: false }).decode(slice);
      bytesBudget   -= sliceLen;
    }

    // Raw binary formats (direct upload, not base64-in-JSON)
    if (snippet.startsWith('PK') || snippet.includes('UEsD')) return 'binary';
    if (snippet.startsWith('%PDF') || snippet.includes('JVBER'))  return 'binary';

    // File embedded as base64 inside a JSON request body — CHECK FIRST
    // before the generic JSON keys below, because these requests also contain
    // "contents", "parts", "text" etc. as outer JSON scaffolding.
    if (hasInlineFilePayload(snippet)) {
      return 'file-in-json';
    }

    // Plain text-only prompt — no file content
    if (snippet.includes('"text"') || snippet.includes('"parts"') ||
        snippet.includes('"contents"')) {
      return 'text-only';
    }

  } catch (_) {}
  return 'unknown';
}

function hasInlineFilePayload(snippet) {
  if (!snippet) return false;
  if (snippet.includes('inlineData') || snippet.includes('fileData')) return true;

  var longData = '[A-Za-z0-9+/=]{' + MIN_BASE64_DATA_CHARS + ',}';
  return new RegExp('"mimeType"\\s*:\\s*"[^"]+"\\s*,\\s*"data"\\s*:\\s*"' + longData + '"').test(snippet) ||
         new RegExp('"data"\\s*:\\s*"' + longData + '"\\s*,\\s*"mimeType"\\s*:\\s*"[^"]+"').test(snippet);
}

/**
 * Estimate the plain-text token count from a file-in-JSON payload.
 *
 * The base64 data inside the JSON inflates size in two layers:
 *   Layer 1 — Base64 encoding:     rawBytes / 1.33 → original file bytes
 *   Layer 2 — Binary format bloat: originalBytes / deflationRatio → text bytes
 *   Layer 3 — Tokenisation:        textBytes / 4 → tokens
 *
 * Deflation ratios:
 *   .docx / .pptx  ≈ 18   (ZIP-compressed XML)
 *   .pdf           ≈ 15   (binary + font tables)
 *   .xlsx          ≈ 20   (ZIP-compressed XML)
 *   unknown binary ≈ 12   (conservative)
 *
 * We don't know the file type from the raw body, so we use 15 as the middle
 * ground. The mammoth path in content.js gives exact counts for .docx — this
 * is only the network fallback.
 */
function estimateTokensFromBase64Payload(totalRawBytes) {
  const originalBytes  = totalRawBytes / 1.33;  // undo base64 expansion
  const deflationRatio = 15;                     // conservative middle ground
  const textChars      = originalBytes / deflationRatio;
  return Math.max(1, Math.ceil(textChars / 4));
}

function sumRawBytes(rawChunks) {
  if (!rawChunks || !rawChunks.length) return 0;
  return rawChunks.reduce((t, c) => t + (c.bytes ? c.bytes.byteLength : 0), 0);
}

function notifyTab(tabId, payload) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, payload, () => {
    if (chrome.runtime.lastError) { /* swallow */ }
  });
}

// ─── A. Upload detection (onBeforeRequest — reads request body) ───────────────

chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    if (details.method !== 'POST') return;
    if (!details.url.includes('gemini.google.com')) return;
    if (!looksLikeGenerateUrl(details.url)) return;

    const body = details.requestBody;
    if (!body) return;

    let totalBytes   = 0;
    let payloadClass = 'unknown';

    if (body.raw && body.raw.length) {
      totalBytes   = sumRawBytes(body.raw);
      payloadClass = classifyPayload(body.raw);   // uses full 4KB scan
    } else if (body.formData) {
      try {
        totalBytes = JSON.stringify(body.formData).length;
        const keys = Object.keys(body.formData || {});
        payloadClass = keys.some(key => /file|upload|inlineData|fileData/i.test(key))
          ? 'file-in-json'
          : 'unknown';
      } catch (_) {}
    }

    // Skip tiny requests (heartbeats, analytics) and confirmed text-only prompts
    if (totalBytes < MIN_BODY_BYTES) return;
    if (payloadClass !== 'file-in-json' && payloadClass !== 'binary') return;
    if (payloadClass === 'text-only') return;

    // For file-in-JSON, correct for base64 + binary format inflation.
    const estimatedTokens = payloadClass === 'file-in-json'
      ? estimateTokensFromBase64Payload(totalBytes)
      : Math.ceil(totalBytes / 20 / 4);  // raw binary fallback


    notifyTab(details.tabId, {
      type:             'GTM_FILE_UPLOAD_DETECTED',
      rawBytes:         totalBytes,
      estimatedTokens:  estimatedTokens,
      payloadClass:     payloadClass,
      url:              details.url,
    });
  },
  { urls: GEMINI_PATTERNS },
  ['requestBody']
);

// ─── B. Response stream parsing (StreamFilter — reads response body) ──────────
//
// We attach a StreamFilter to every streaming response from Gemini's generate
// endpoint. The filter buffers all chunks, passes them through unmodified
// (so the page works normally), and after the stream closes, we search the
// accumulated text for usageMetadata JSON.
//
// The StreamFilter API is available via chrome.webRequest.filter() in MV3
// background service workers that have the "webRequest" permission.

// Only attach filters to the actual generate/stream endpoints — not to every
// resource load on gemini.google.com (images, CSS, etc.)
const GENERATE_URL_HINTS = [
  '_/BardChatUi/data/assistant',
  'StreamGenerate',
  'stream',
  'generate',
];

function looksLikeGenerateUrl(url) {
  return GENERATE_URL_HINTS.some(h => url.includes(h));
}

/**
 * Parse usageMetadata from accumulated response text.
 * Gemini sends one or more JSON objects per stream. The final one contains
 * usageMetadata. We scan from the end for the last occurrence.
 *
 * @param {string} text
 * @returns {{ totalTokens, thoughtTokens, promptTokens } | null}
 */
function parseUsageMetadata(text) {
  // Find last occurrence of "usageMetadata" in the stream
  const idx = text.lastIndexOf('"usageMetadata"');
  if (idx === -1) return null;

  // Grab a generous slice after the key to find the object
  const slice = text.slice(idx, idx + 400);

  // Try to extract the individual fields with regex
  // (full JSON.parse is unreliable on partial/streaming content)
  function extractInt(src, key) {
    const m = src.match(new RegExp('"' + key + '"\\s*:\\s*(\\d+)'));
    return m ? parseInt(m[1], 10) : 0;
  }

  const totalTokens   = extractInt(slice, 'totalTokenCount');
  const promptTokens  = extractInt(slice, 'promptTokenCount');
  const thoughtTokens = extractInt(slice, 'thoughtsTokenCount');  // Thinking mode
  const candidates    = extractInt(slice, 'candidatesTokenCount');

  if (totalTokens === 0 && promptTokens === 0) return null;

  return {
    totalTokens:   totalTokens  || (promptTokens + candidates),
    promptTokens:  promptTokens,
    thoughtTokens: thoughtTokens,
  };
}

chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    // Only process GET/streaming responses — POST handled above
    if (details.method !== 'GET' && details.method !== 'POST') return;
    if (!looksLikeGenerateUrl(details.url)) return;

    // Attach a StreamFilter to tap the response bytes
    if (typeof chrome.webRequest.filterResponseData !== 'function') return;
    let filter;
    try {
      filter = chrome.webRequest.filterResponseData(details.requestId);
    } catch (_) {
      // StreamFilter not available in this context — skip silently
      return;
    }

    const decoder = new TextDecoder('utf-8', { fatal: false });
    let accumulated = '';

    filter.ondata = function(event) {
      // Pass the chunk through unmodified so the page receives it
      filter.write(event.data);
      // Accumulate for our own parsing (only keep last 2KB — metadata is at end)
      accumulated += decoder.decode(event.data, { stream: true });
      if (accumulated.length > 8192) {
        accumulated = accumulated.slice(-8192);  // rolling window
      }
    };

    filter.onstop = function() {
      filter.close();
      if (!accumulated) return;

      const meta = parseUsageMetadata(accumulated);
      if (!meta) return;


      notifyTab(details.tabId, {
        type:          'GTM_SERVER_TOKENS',
        totalTokens:   meta.totalTokens,
        promptTokens:  meta.promptTokens,
        thoughtTokens: meta.thoughtTokens,
        url:           details.url,
      });
    };

    filter.onerror = function() {
      // Network error or filter detached — ignore
    };
  },
  { urls: GEMINI_PATTERNS },
  ['requestBody']  // requestBody needed to attach filter
);

