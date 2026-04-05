/**
 * tokenizer.js
 * Token counting logic for the Gemini Token Meter.
 *
 * Two modes (toggled via popup settings):
 *
 *   1. HEURISTIC (default, offline):
 *      Math.ceil(charCount / 4) — standard Gemini 2026 approximation.
 *
 *   2. API (pro accuracy):
 *      Calls Google's free countTokens endpoint:
 *      POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:countTokens
 *      API key is read from chrome.storage.local — never hardcoded.
 *      Falls back to heuristic automatically on any API error.
 *
 * Other rules:
 *  - Image    : 689 tokens avg (midpoint of 258–1120 per Google docs)
 *  - Document : 560 tokens per page
 *  - Thinking : pulled from thoughts_token_count DOM attribute
 */

const Tokenizer = (() => {
  // ─── Constants ────────────────────────────────────────────────────────────
  let CONTEXT_LIMIT        = 128_000;
  const CHARS_PER_TOKEN    = 4;
  const CHARS_PER_CODE_TOKEN = 2.5;
  const FALLBACK_IMAGE_TOKENS = 689;   // legacy fallback when dimensions are unknown
  const TOKENS_PER_IMAGE_TILE = 258;
  const TOKENS_PER_DOC_PAGE = 560;
  const GEMINI3_IMAGE_TOKEN_BUCKETS = [
    { maxSide: 512,  tokens: 280 },
    { maxSide: 1024, tokens: 560 },
    { maxSide: 2048, tokens: 1120 },
    { maxSide: Infinity, tokens: 2240 },
  ];

  // Thresholds for UI colour changes
  const WARN_THRESHOLD  = 0.60;   // 60% → yellow
  const ALERT_THRESHOLD = 0.80;   // 80% → red

  // ─── Core helpers ─────────────────────────────────────────────────────────

  /**
   * Estimate tokens from raw text.
   * Uses a dual-heuristic:
   *  - Markdown code blocks (```...```) are high-entropy → denser token estimate
   *  - Remaining natural language uses the standard 4 chars/token heuristic
   * @param {string} text
   * @returns {number}
   */
  function countTextTokens(text = '') {
    if (!text || typeof text !== 'string') return 0;

    let totalTokens = 0;
    const codeBlockRegex = /```[\s\S]*?```/g;

    // Sum code blocks using raw length (preserve whitespace/indentation)
    let lastIdx = 0;
    let match;
    const nonCodeParts = [];
    while ((match = codeBlockRegex.exec(text)) !== null) {
      const start = match.index;
      const block = match[0] || '';

      // Non-code segment before this block
      if (start > lastIdx) nonCodeParts.push(text.slice(lastIdx, start));

      totalTokens += Math.ceil(block.length / CHARS_PER_CODE_TOKEN);
      lastIdx = start + block.length;
    }

    // Trailing non-code segment
    if (lastIdx < text.length) nonCodeParts.push(text.slice(lastIdx));

    // Natural language: squash whitespace
    const cleanedText = nonCodeParts.join(' ').replace(/\s+/g, ' ').trim();
    if (cleanedText.length > 0) {
      totalTokens += Math.ceil(cleanedText.length / CHARS_PER_TOKEN);
    }

    return totalTokens;
  }

  function estimateLegacyImageInputTokens(width = 0, height = 0) {
    const w = Math.max(0, Math.ceil(Number(width) || 0));
    const h = Math.max(0, Math.ceil(Number(height) || 0));
    if (!w || !h) return FALLBACK_IMAGE_TOKENS;

    if (w <= 384 && h <= 384) {
      return TOKENS_PER_IMAGE_TILE;
    }

    // Gemini Flash-style image understanding uses a crop unit derived from the
    // shorter image side, not a fixed 768px grid.
    const cropUnit = Math.floor(Math.min(w, h) / 1.5);
    if (cropUnit <= 0) return TOKENS_PER_IMAGE_TILE;

    return Math.ceil(w / cropUnit) * Math.ceil(h / cropUnit) * TOKENS_PER_IMAGE_TILE;
  }

  function estimateGemini3ImageInputTokens(width = 0, height = 0) {
    const w = Math.max(0, Math.ceil(Number(width) || 0));
    const h = Math.max(0, Math.ceil(Number(height) || 0));
    const maxSide = Math.max(w, h);
    if (!maxSide) return 1120;

    for (const bucket of GEMINI3_IMAGE_TOKEN_BUCKETS) {
      if (maxSide <= bucket.maxSide) return bucket.tokens;
    }

    return 1120;
  }

  function getImageEstimatorProfile(context = {}) {
    const mode = String(context.mode || '').toLowerCase();
    const label = String(context.modelLabel || '').toLowerCase();
    const combined = `${mode} ${label}`;

    // Gemini app "Fast" is officially documented as a 2.5 Flash path in
    // current support docs, so we keep the legacy tiling estimate there.
    if (/\bfast\b/.test(combined) || /2\.5\s*flash/.test(combined) || /\bflash\b/.test(combined)) {
      return 'gemini-fast-legacy-tiles';
    }

    // Gemini app Thinking / Pro are powered by the Gemini 3 family. The app
    // does not expose media_resolution directly, so we use a size-bucketed
    // heuristic derived from Gemini 3 media-resolution token budgets.
    if (/\bthinking\b/.test(combined) || /\bpro\b/.test(combined) || /3\.1/.test(combined) ||
        /deep think/.test(combined) || /gemini 3/.test(combined)) {
      return 'gemini-3-media-buckets';
    }

    return 'gemini-fast-legacy-tiles';
  }

  function estimateAppImageInputTokens(width = 0, height = 0, context = {}) {
    const profile = getImageEstimatorProfile(context);
    if (profile === 'gemini-3-media-buckets') {
      return estimateGemini3ImageInputTokens(width, height);
    }
    return estimateLegacyImageInputTokens(width, height);
  }

  function estimateImageInputTokens(width = 0, height = 0, context = {}) {
    return estimateAppImageInputTokens(width, height, context);
  }

  function estimateGeneratedImageTokens(width = 0, height = 0, context = {}) {
    return estimateAppImageInputTokens(width, height, context);
  }

  /**
   * Count tokens for a single message object.
   * @param {{ role: string, text: string, images: number, docPages: number, thinkingTokens: number }} msg
   * @returns {number}
   */
  function countMessageTokens(msg) {
    const textTokens     = countTextTokens(msg.text || '');
    const imageTokens    = Number.isFinite(msg.imageTokens)
      ? Math.max(0, msg.imageTokens)
      : (msg.images || 0) * FALLBACK_IMAGE_TOKENS;
    const docTokens      = (msg.docPages  || 0) * TOKENS_PER_DOC_PAGE;
    const thinkingTokens = msg.thinkingTokens || 0;

    return textTokens + imageTokens + docTokens + thinkingTokens;
  }

  /**
   * Sum tokens across the full conversation history.
   * @param {Array} messages  Array of message objects
   * @returns {{ total: number, input: number, output: number }}
   */
  function countConversationTokens(messages = []) {
    let input  = 0;
    let output = 0;

    for (const msg of messages) {
      const t = countMessageTokens(msg);
      if (msg.role === 'user') {
        input += t;
      } else {
        output += t;
      }
    }

    return { total: input + output, input, output };
  }

  /**
   * Return fill percentage (0–1) and the UI state string.
   * @param {number} usedTokens
   * @returns {{ pct: number, state: 'safe'|'warn'|'alert' }}
   */
  function getContextState(usedTokens) {
    const pct   = Math.min(usedTokens / CONTEXT_LIMIT, 1);
    const state = pct >= ALERT_THRESHOLD ? 'alert'
                : pct >= WARN_THRESHOLD  ? 'warn'
                : 'safe';
    return { pct, state };
  }

  /**
   * Update the context limit dynamically based on active plan/model.
   * @param {number} limit
   */
  function updateContextLimit(limit) {
    const n = Number(limit);
    if (!Number.isFinite(n) || n <= 0) return;
    CONTEXT_LIMIT = Math.floor(n);
  }

  // ─── countTokens API (optional, pro accuracy) ─────────────────────────────

  const COUNT_TOKENS_BASE =
    'https://generativelanguage.googleapis.com/v1beta/models/';
  const COUNT_TOKENS_DEFAULT_MODEL = 'gemini-2.0-flash';

  function resolveCountTokensModel(modelLabel) {
    const label = String(modelLabel || '').toLowerCase();
    if (!label) return COUNT_TOKENS_DEFAULT_MODEL;
    if (/(^|\\b)2\\.5\\b/.test(label) && /pro/.test(label)) return 'gemini-2.5-pro';
    if (/(^|\\b)2\\.5\\b/.test(label) && /flash/.test(label)) return 'gemini-2.5-flash';
    if (/(^|\\b)2\\.0\\b/.test(label) && /pro/.test(label)) return 'gemini-2.0-pro';
    if (/(^|\\b)2\\.0\\b/.test(label) && /flash/.test(label)) return 'gemini-2.0-flash';
    if (/(^|\\b)1\\.5\\b/.test(label) && /pro/.test(label)) return 'gemini-1.5-pro';
    if (/(^|\\b)1\\.5\\b/.test(label) && /flash/.test(label)) return 'gemini-1.5-flash';
    if (/flash/.test(label)) return 'gemini-2.0-flash';
    if (/pro/.test(label)) return 'gemini-2.0-pro';
    return COUNT_TOKENS_DEFAULT_MODEL;
  }

  function getCountTokensUrl(modelLabel) {
    const model = resolveCountTokensModel(modelLabel);
    return COUNT_TOKENS_BASE + model + ':countTokens';
  }

  /**
   * Call Google's free countTokens endpoint for a single text string.
   * Reads the API key from chrome.storage.local — never from source code.
   *
   * @param {string} text
   * @returns {Promise<number>}  Resolves to exact token count, or heuristic on failure.
   */
  async function countTokensViaAPI(text, modelLabel) {
    if (!text || typeof text !== 'string') return 0;

    // Read key and mode flag from storage — guarded against invalidated context
    const stored = await new Promise((resolve) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime) {
          return resolve({});
        }
        if (!chrome.runtime.id) return resolve({});
        chrome.storage.local.get(['gtm_api_key', 'gtm_use_api'], function(result) {
          if (chrome.runtime.lastError) return resolve({});
          resolve(result || {});
        });
      } catch (_) {
        resolve({});
      }
    });

    const apiKey = stored.gtm_api_key || '';
    const useApi = stored.gtm_use_api || false;

    // If API mode is off or no key is present, return heuristic immediately
    if (!useApi || !apiKey) return countTextTokens(text);

    try {
      const url = getCountTokensUrl(modelLabel);
      const response = await fetch(`${url}?key=${apiKey}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contents: [{ parts: [{ text }] }],
        }),
      });

      if (!response.ok) {
        return countTextTokens(text);
      }

      const data = await response.json();
      return data.totalTokens ?? countTextTokens(text);

    } catch (err) {
      return countTextTokens(text);
    }
  }

  /**
   * Count tokens for the full conversation using API (async) or heuristic.
   * API calls are batched: one call per message, run in parallel.
   *
   * @param {Array} messages
   * @returns {Promise<{ total: number, input: number, output: number }>}
   */
  async function countConversationTokensAsync(messages = [], modelLabel) {
    const results = await Promise.all(
      messages.map(async (msg) => {
        const textTokens     = await countTokensViaAPI(msg.text || '', modelLabel);
        const imageTokens    = Number.isFinite(msg.imageTokens)
          ? Math.max(0, msg.imageTokens)
          : (msg.images || 0) * FALLBACK_IMAGE_TOKENS;
        const docTokens      = (msg.docPages  || 0) * TOKENS_PER_DOC_PAGE;
        const thinkingTokens = msg.thinkingTokens || 0;
        const total          = textTokens + imageTokens + docTokens + thinkingTokens;
        return { role: msg.role, total };
      })
    );

    let input = 0, output = 0;
    for (const { role, total } of results) {
      if (role === 'user') input += total;
      else                 output += total;
    }
    return { total: input + output, input, output };
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  return {
    get CONTEXT_LIMIT() { return CONTEXT_LIMIT; },
    updateContextLimit,
    WARN_THRESHOLD,
    ALERT_THRESHOLD,
    countTextTokens,
    estimateImageInputTokens,
    estimateAppImageInputTokens,
    estimateLegacyImageInputTokens,
    estimateGemini3ImageInputTokens,
    getImageEstimatorProfile,
    estimateGeneratedImageTokens,
    countMessageTokens,
    countConversationTokens,
    countTokensViaAPI,            // async, API-first with heuristic fallback
    countConversationTokensAsync, // async, full conversation with API
    getContextState,
  };
})();
