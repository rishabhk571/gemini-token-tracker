/**
 * content.js  v1.4  BUILD-2026-FINAL
 *
 * Key changes:
 *   1. File interception Ã¢â‚¬â€ hooks into Gemini's file <input> BEFORE upload.
 *      Runs mammoth.js on .docx to get plain text token count.
 *      For other types uses word-count or conservative byte/20 estimate.
 *   2. Network signal handling Ã¢â‚¬â€ background.js now sends GTM_FILE_UPLOAD_DETECTED
 *      (bytes only). content.js applies correct ratio based on type already known
 *      from the file interceptor, falling back to bytes/20 for unknowns.
 *   3. All previous fixes retained: shadow DOM piercing, cleanText(), SKIP_TAGS.
 *
 * Requires: mammoth.browser.min.js loaded before this file (see manifest.json).
 */

(() => {
  'use strict';

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Selectors Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  const SELECTORS = {
    userTurn: [
      '[data-message-author-role="user"]',
      'user-query[data-message-author-role="user"]',
      '.user-query-bubble-with-background',
      '.user-query',
      'user-query-content',
      'user-query',
    ],
    modelTurn: [
      '[data-message-author-role="model"]',
      'model-response[data-message-author-role="model"]',
      '.model-response',
      'model-response-text',
      '.response-container',
      'model-response',
    ],
    turnText: [
      '.query-text',
      '.markdown',
      '.response-content',
      '[data-text-content]',
      'message-content',
    ],
    thinkingSection: [
      '[thoughts_token_count]',
      '.thinking-section',
      'thinking-content',
      '[data-thinking-tokens]',
      'thought-chunk',
    ],
    inlineImage: [
      'img[src^="blob:"]',
      'img.uploaded-image',
      'img.image.loaded',
      'img[alt*="AI generated"]',
      'img[src*="lh3.googleusercontent.com/gg-dl/"]',
      '.image-attachment img',
      '.file-attachment img',
      'image',
      'canvas',
      'video',
      '[style*="background-image"]',
      '[data-image-url]',
    ],
    attachmentChip: [
      '[data-test-id="uploaded-file-chip"]',
      'file-upload-chip',
      'uploaded-file',
      '[data-file-name]',
      '[aria-label^="Remove file "]',
    ],
    draftInput: [
      'rich-textarea [contenteditable="true"]',
      'p[data-placeholder]',
      'div[contenteditable="true"]',
      'rich-textarea',
      'textarea',
    ],
  };

  const ATTACHMENT_CANDIDATE_SELECTORS = [
    '[data-test-id="uploaded-file-chip"]',
    'file-upload-chip',
    'uploaded-file',
    '[data-file-name]',
    '[aria-label^="Remove file "]',
  ];

  const SYSTEM_ATTACHMENT_ANCESTOR_SELECTORS = [
    'input-area-v2',
    'text-input-v2',
    '.input-area',
    'form',
    '.input-footer',
    '[data-test-id="bottom-bar"]',
    '[data-test-id="pillbox"]',
    '.pillbox',
    '.model-selector-button',
    '[class*="upsell"]',
    '[aria-label*="Upgrade"]',
    'code-immersive-panel',
    'immersive-panel',
    'deep-research-immersive-panel',
    '[data-test-id*="canvas"]',
    '[data-test-id*="code-editor"]',
    'browse-chip-list',
    'browse-file-chip',
    '[data-test-id="browse-chip"]',
    '[class*="canvas"]',
    '.ProseMirror',
    'template',
  ].join(', ');

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ File token store Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //
  // Maps a file identity key (name + size) Ã¢â€ â€™ extracted token count.
  // Populated by the file input interceptor BEFORE upload.
  // Used during recalculate() to add file tokens to the conversation total.
  //
  var fileTokenStore = {};   // { 'report.docx:45231': 5300, ... }
  var fileMetaStore  = {};   // { 'report.docx:45231': { name, size, kind, width, height, tokens } }
  var trackedUploadOrder = []; // insertion order of local draft uploads
  var totalFileTokens = 0;   // running sum, updated on every file pick
  var attachmentInteractionSeen = false;
  var storedHistoryAttachmentTokens = 0;
  var historyAttachmentLoaded = false;
  var lastSentAttachmentSignature = '';
  var lastSentAttachmentAt = 0;
  var SENT_ATTACHMENT_DEDUP_MS = 5000;
  var pendingDraftAttachmentTokens = 0;
  var pendingDraftAttachmentSignature = '';
  var lastUserTurnCount = 0;
  var pendingSendAttachmentTokens = 0;
  var pendingSendAttachmentSignature = '';
  var pendingSendAttachmentAt = 0;
  var backfillActive = false;
  var backfillUntil = 0;
  var backfillChatId = '';
  var backfillScrollTarget = null;
  var backfillLastScrollAt = 0;
  var BACKFILL_WINDOW_MS = 2 * 60 * 1000;
  var BACKFILL_LOG_INTERVAL_MS = 1000;
  var backfillLastLogAt = 0;
  var DEBUG_FLAG_KEY = 'gtm_debug';
  var FORCE_SILENT_LOGS = true;
  var DEBUG_CHAT_KEY = 'gtm_debug_chat';
  var DEBUG_CANVAS_KEY = 'gtm_debug_canvas';
  var CANVAS_COUNT_MODE_KEY = 'gtm_canvas_mode';
  var debugChatEnabled = false;
  var lastDebugChatCheckAt = 0;
  var debugChatCacheId = '';
  var lastChatDebugSignature = '';
  var canvasDebugEnabled = false;
  var lastDebugCanvasCheckAt = 0;
  var lastCanvasDebugSignature = '';
  var canvasDebugSeq = 0;
  var debugEnabled = false;
  var lastDebugFlagCheckAt = 0;
  var lastAttachmentDebugSignature = '';
  var debugOnceMap = {};
  var debugOnceQueue = [];
  var DEBUG_ONCE_MAX = 200;
  var currentModelLabel = '';
  var currentModelMode = '';
  var currentPlanTier = 'Unknown';
  var currentPlanTierConfidence = 'low';
  var currentPlanTierSource = 'init';
  var lastMeterBreakdown = null;
  var lastAttachmentSourceWarning = '';
  var recentClipboardFingerprints = [];
  var recentClipboardAt = 0;
  var modelImageDebug = new WeakMap();
  var CLIPBOARD_DEDUP_WINDOW_MS = 700;
  var canvasTokens = 0;
  var canvasRoot = null;
  var canvasObserver = null;
  var canvasDebounceTimer = null;
  var canvasLastSignature = '';
  var canvasTextSource = 'none';
  var canvasMonacoText = '';
  var canvasMonacoLastAt = 0;
  var canvasBridgeInjected = false;
  var canvasLastRequestAt = 0;
  var canvasCountMode = 'code';
  var CANVAS_DEBOUNCE_MS = 750;
  var CANVAS_MAX_CHARS = 200000;
  var CANVAS_REQUEST_MIN_MS = 400;
  var CANVAS_SIGNATURE_TAIL_LEN = 200;
  var CANVAS_MONACO_STALE_MS = 4000;
  var CANVAS_ROOT_SELECTORS = [
    'code-immersive-panel',
    'immersive-panel',
    'deep-research-immersive-panel',
    '[data-test-id="code-editor"]',
    '[data-test-id="canvas-content"]',
    '[data-test-id*="code-editor"]',
    '[data-test-id*="canvas-content"]',
  ];
  var CANVAS_EDITOR_SELECTORS = [
    '[data-test-id="code-editor"]',
    '[data-test-id*="code-editor"]',
    'xap-code-editor',
    '.monaco-editor',
  ];
  var CANVAS_DOC_TEXT_SELECTORS = [
    'immersive-panel #extended-response-markdown-content',
    'deep-research-immersive-panel #extended-response-markdown-content',
    'immersive-panel message-content .markdown-main-panel',
    'deep-research-immersive-panel message-content .markdown-main-panel',
    'immersive-panel message-content .markdown',
    'deep-research-immersive-panel message-content .markdown',
    'immersive-panel structured-content-container[data-test-id="message-content"] message-content',
    'deep-research-immersive-panel structured-content-container[data-test-id="message-content"] message-content',
    '[data-test-id="canvas-content"]',
    '[data-test-id*="canvas-content"]',
    '[data-test-id*="canvas-editor"]',
    '[data-test-id*="doc-editor"]',
    '.ProseMirror',
    '[role="textbox"]',
    '[contenteditable="true"]',
    'textarea',
  ];
  var CANVAS_DOC_EXCLUDE_SELECTORS = [
    'source-list',
    '.used-sources',
    'sources-carousel',
    'sources-carousel-inline',
    '[data-test-id="sources"]',
    '[data-test-id="sources-carousel-source"]',
    'browse-chip-list',
    'browse-web-chip',
    'browse-file-chip',
    'browse-web-item',
    'browse-file-item',
    '[data-test-id="browse-chip-link"]',
    '[data-test-id="browse-web-item-link"]',
    '[data-test-id="view-file-button"]',
    'source-footnote',
    'sup[data-turn-source-index]',
  ].join(', ');
  var CANVAS_CONTAINER_HINTS = [
    'code-immersive-panel',
    'immersive-panel',
    'deep-research-immersive-panel',
    '[data-test-id*="canvas-content"]',
    '[data-test-id*="code-editor"]',
    '.monaco-editor',
  ].join(', ');

  function fileKey(file) {
    return [
      file.name || 'unknown',
      file.size || 0,
      file.lastModified || 0,
      file.type || '',
    ].join(':');
  }

  function getClipboardFingerprint(file) {
    if (!file) return '';
    return [
      'clipboard-image',
      String(file.type || '').toLowerCase(),
      file.size || 0,
    ].join(':');
  }

  function rememberRecentClipboardFiles(files) {
    recentClipboardAt = Date.now();
    recentClipboardFingerprints = (files || []).map(getClipboardFingerprint).filter(Boolean);
  }

  function shouldIgnoreClipboardEcho(file) {
    if (!file || !looksLikeImageFile(file)) return false;
    if (!recentClipboardFingerprints.length) return false;
    if ((Date.now() - recentClipboardAt) > CLIPBOARD_DEDUP_WINDOW_MS) return false;
    return recentClipboardFingerprints.indexOf(getClipboardFingerprint(file)) !== -1;
  }

  function getActiveImageEstimatorContext() {
    return {
      mode: currentModelMode,
      modelLabel: currentModelLabel,
    };
  }

  function getTrackedUploadDebugList() {
    return getOrderedTrackedUploadKeys().map(function(key) {
      var meta = fileMetaStore[key] || {};
      return {
        key: key,
        name: meta.name || key.split(':')[0] || 'unknown',
        kind: meta.kind || 'file',
        tokens: fileTokenStore[key] || 0,
        width: meta.width || 0,
        height: meta.height || 0,
        estimatorProfile: meta.estimatorProfile || '',
        modelMode: meta.modelMode || '',
        modelLabel: meta.modelLabel || '',
      };
    });
  }

  function refreshTrackedImageTokenEstimates() {
    var estimatorContext = getActiveImageEstimatorContext();
    var nextProfile = (Tokenizer && Tokenizer.getImageEstimatorProfile)
      ? Tokenizer.getImageEstimatorProfile(estimatorContext)
      : '';
    var changed = false;

    getOrderedTrackedUploadKeys().forEach(function(key) {
      var meta = fileMetaStore[key];
      if (!meta || meta.kind !== 'image') return;

      var nextTokens = Tokenizer.estimateImageInputTokens(
        meta.width || 0,
        meta.height || 0,
        estimatorContext
      );

      if (fileTokenStore[key] !== nextTokens ||
          meta.estimatorProfile !== nextProfile ||
          meta.modelMode !== estimatorContext.mode ||
          meta.modelLabel !== estimatorContext.modelLabel) {
        fileTokenStore[key] = nextTokens;
        meta.tokens = nextTokens;
        meta.estimatorProfile = nextProfile;
        meta.modelMode = estimatorContext.mode || '';
        meta.modelLabel = estimatorContext.modelLabel || '';
        changed = true;
      }
    });

    if (!changed) return false;

    totalFileTokens = Object.values(fileTokenStore)
      .reduce(function(acc, t) { return acc + t; }, 0);
    if (currentChatId && totalFileTokens > 0) {
      saveFileTokens(totalFileTokens);
    }
    return true;
  }

  function updateMeterBreakdown(breakdown) {
    lastMeterBreakdown = breakdown || null;

    try {
      window.__gtmTokenMeterDebug = window.__gtmTokenMeterDebug || {};
      window.__gtmTokenMeterDebug.getBreakdown = function() {
        return lastMeterBreakdown;
      };
      window.__gtmTokenMeterDebug.getTrackedUploads = function() {
        return getTrackedUploadDebugList();
      };
      window.__gtmTokenMeterDebug.clearHistoryAttachment = clearHistoryAttachmentTokens;
      window.__gtmTokenMeterDebug.forceCanvasRescan = function() {
        if (canvasRoot) scheduleCanvasScan(canvasRoot, true);
      };
      window.__gtmTokenMeterDebug.setCanvasMode = function(mode) {
        canvasCountMode = normalizeCanvasCountMode(mode);
        canvasLastSignature = '';
        try {
          if (chrome && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ [CANVAS_COUNT_MODE_KEY]: canvasCountMode });
          }
        } catch (_) {}
        if (canvasRoot) scheduleCanvasScan(canvasRoot, true);
      };
    } catch (_) {}
  }

  function getEstimatorProfileLabel(profile) {
    switch (String(profile || '')) {
      case 'gemini-fast-legacy-tiles':
        return 'Fast tiles';
      case 'gemini-3-media-buckets':
        return 'Gemini 3 bucket';
      default:
        return 'Local estimate';
    }
  }

  function buildMeterEstimateIndicator(breakdown) {
    var data = breakdown || {};
    var sources = data.sources || {};
    var counts = data.counts || {};
    var trackedUploads = data.trackedUploads || [];
    var imageUploads = trackedUploads.filter(function(upload) {
      return upload && upload.kind === 'image';
    });
    var serverPromptWins = sources.serverPromptTokens > 0 &&
      sources.serverPromptTokens > (counts.input || 0) &&
      (counts.finalInput || 0) >= sources.serverPromptTokens;

    if (serverPromptWins) {
      return {
        badge: 'Estimator',
        text: 'Server prompt',
        title: 'Post-send input count is being floored by Gemini server prompt metadata.',
      };
    }

    if (sources.chosenAttachmentSource === 'local-upload-store' && trackedUploads.length > 0) {
      if (imageUploads.length > 0) {
        var firstProfile = imageUploads[0].estimatorProfile || '';
        var mixedProfiles = imageUploads.some(function(upload) {
          return (upload.estimatorProfile || '') !== firstProfile;
        });
        var detail = mixedProfiles
          ? 'Mixed image estimates'
          : getEstimatorProfileLabel(firstProfile);
        return {
          badge: 'Estimator',
          text: detail,
          title: mixedProfiles
            ? 'Attachment estimate is coming from tracked local images using multiple estimator profiles.'
            : 'Attachment estimate is coming from tracked local images using ' + detail.toLowerCase() + '.',
        };
      }

      return {
        badge: 'Estimator',
        text: 'Tracked uploads',
        title: 'Attachment estimate is coming from the local upload store.',
      };
    }

    if (sources.chosenAttachmentSource === 'network-fallback' &&
        sources.chosenAttachmentTokens > 0) {
      return {
        badge: 'Estimator',
        text: 'Network fallback',
        title: 'Attachment estimate is coming from Gemini upload network signals.',
      };
    }

    if (sources.chosenAttachmentSource === 'dom-chip-fallback' &&
        sources.chosenAttachmentTokens > 0) {
      return {
        badge: 'Estimator',
        text: 'DOM fallback',
        title: 'Attachment estimate is coming from visible Gemini attachment chips.',
      };
    }

    if (sources.chosenAttachmentSource === 'history-storage' &&
        sources.chosenAttachmentTokens > 0) {
      return {
        badge: 'History',
        text: 'Persistent attachment',
        title: 'A previously sent file (' + sources.chosenAttachmentTokens.toLocaleString() + ' tk) is persisting in this conversation\'s context window on every turn. Start a new chat, or clear it manually using the button below.',
      };
    }

    return null;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ mammoth.js text extraction Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  /**
   * Extract plain text from a .docx File object using mammoth.js.
   * mammoth strips all XML, styles, and metadata Ã¢â‚¬â€ returns only readable text.
   *
   * @param {File} file
   * @returns {Promise<string>}  Plain text or '' on failure
   */
  async function extractDocxText(file) {
    if (typeof mammoth === 'undefined') {
      if (isDebugEnabled()) console.warn('[TokenMeter] mammoth.js not loaded Ã¢â‚¬â€ using size fallback');
      return '';
    }
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result      = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
      return result.value || '';
    } catch (err) {
      if (isDebugEnabled()) console.warn('[TokenMeter] mammoth extraction failed:', err.message);
      return '';
    }
  }

  /**
   * Extract text from a plain text file (txt, md, csv, json, etc.)
   * @param {File} file
   * @returns {Promise<string>}
   */
  async function extractPlainText(file) {
    return new Promise(function(resolve) {
      const reader = new FileReader();
      reader.onload  = function(e) { resolve(e.target.result || ''); };
      reader.onerror = function()  { resolve(''); };
      reader.readAsText(file);
    });
  }

  function getTextSignature(text) {
    var cleaned = cleanText(text || '');
    if (!cleaned) return '0';
    return [
      cleaned.length,
      cleaned.slice(0, 48),
      cleaned.slice(-48),
    ].join(':');
  }

  function getCanvasSignature(text, isCode, mode) {
    var len = text ? text.length : 0;
    if (!len) return '0';
    var head = text.slice(0, 200);
    var tail = text.slice(Math.max(0, len - CANVAS_SIGNATURE_TAIL_LEN));
    var hash = 0;
    for (var i = 0; i < len; i += Math.max(1, Math.floor(len / 1200))) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return String(len) + '|' + head + '|' + tail + '|' + hash + '|' + mode + '|' + (isCode ? '1' : '0');
  }

  function getConversationSignature(messages) {
    return messages.map(function(msg) {
      return [
        msg.role || '',
        getTextSignature(msg.text || ''),
        msg.imageTokens || 0,
        msg.images || 0,
        msg.docTokens || 0,
        msg.docPages || 0,
        msg.thinkingTokens || 0,
      ].join('~');
    }).join('|');
  }

  async function getConversationCounts(messages, apiMode) {
    var heuristicCounts = Tokenizer.countConversationTokens(messages);
    if (!apiMode) return heuristicCounts;

    var signature = getConversationSignature(messages);
    if (signature === lastConversationApiSignature && lastConversationExactCounts) {
      return lastConversationExactCounts;
    }
    if (conversationApiPromise && signature === conversationApiPromiseSignature) {
      return conversationApiPromise;
    }

    var now = Date.now();
    if (lastConversationExactCounts && (now - lastConversationApiAt) < API_THROTTLE_MS) {
      return heuristicCounts;
    }

    lastConversationApiAt = now;
    conversationApiPromiseSignature = signature;
    conversationApiPromise = Tokenizer.countConversationTokensAsync(messages, currentModelLabel)
      .then(function(exactCounts) {
        lastConversationApiSignature = signature;
        lastConversationExactCounts  = exactCounts;
        return exactCounts;
      })
      .finally(function() {
        conversationApiPromise = null;
        conversationApiPromiseSignature = '';
      });

    return conversationApiPromise;
  }

  async function getDraftTokenCount(draftText, apiMode) {
    var heuristicDraftTokens = Tokenizer.countTextTokens(draftText);
    if (!apiMode || !draftText) {
      if (!draftText) {
        lastDraftApiSignature = '';
        lastDraftExactTokens  = 0;
      }
      return heuristicDraftTokens;
    }

    var signature = getTextSignature(draftText);
    if (signature === lastDraftApiSignature) {
      return lastDraftExactTokens;
    }
    if (draftApiPromise && signature === draftApiPromiseSignature) {
      return draftApiPromise;
    }

    var now = Date.now();
    if (lastDraftApiSignature && (now - lastDraftApiAt) < API_THROTTLE_MS) {
      return heuristicDraftTokens;
    }

    lastDraftApiAt = now;
    draftApiPromiseSignature = signature;
    draftApiPromise = Tokenizer.countTokensViaAPI(draftText, currentModelLabel)
      .then(function(exactDraftTokens) {
        lastDraftApiSignature = signature;
        lastDraftExactTokens  = exactDraftTokens;
        return exactDraftTokens;
      })
      .finally(function() {
        draftApiPromise = null;
        draftApiPromiseSignature = '';
      });

    return draftApiPromise;
  }

  /**
   * Conservative fallback: estimate tokens from raw file size in bytes.
   *
   * Deflation ratios (why we can't use raw bytes directly):
   *   .docx  Ã¢â€ â€™ ZIP-compressed XML. Real text Ã¢â€°Ë† rawBytes / 18
   *   .pdf   Ã¢â€ â€™ Binary + font tables. Real text Ã¢â€°Ë† rawBytes / 15
   *   .xlsx  Ã¢â€ â€™ ZIP-compressed XML. Real text Ã¢â€°Ë† rawBytes / 20
   *   other  Ã¢â€ â€™ Unknown binary.     Real text Ã¢â€°Ë† rawBytes / 12
   *
   * Then: tokens = chars / 4
   *
   * @param {File} file
   * @returns {number}
   */
  function estimateTokensFromFileSize(file) {
    const name = (file.name || '').toLowerCase();
    const bytes = file.size || 0;

    let ratio;
    if (name.endsWith('.docx') || name.endsWith('.docm')) ratio = 18;
    else if (name.endsWith('.pdf'))                        ratio = 15;
    else if (name.endsWith('.xlsx') || name.endsWith('.xls')) ratio = 20;
    else if (name.endsWith('.pptx'))                       ratio = 16;
    else                                                   ratio = 12;

    const estimatedChars = Math.ceil(bytes / ratio);
    return Math.ceil(estimatedChars / 4);
  }

  function looksLikeImageFile(file) {
    if (!file) return false;
    var type = String(file.type || '').toLowerCase();
    var name = String(file.name || '').toLowerCase();
    return type.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|svg)$/i.test(name);
  }

  async function getImageDimensions(file) {
    if (!file) return { width: 0, height: 0 };

    if (typeof createImageBitmap === 'function') {
      try {
        var bitmap = await createImageBitmap(file);
        var dims = { width: bitmap.width || 0, height: bitmap.height || 0 };
        try { bitmap.close(); } catch (_) {}
        if (dims.width > 0 && dims.height > 0) return dims;
      } catch (_) {}
    }

    return new Promise(function(resolve) {
      var url = '';
      try {
        url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function() {
          var dims = { width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0 };
          try { URL.revokeObjectURL(url); } catch (_) {}
          resolve(dims);
        };
        img.onerror = function() {
          try { URL.revokeObjectURL(url); } catch (_) {}
          resolve({ width: 0, height: 0 });
        };
        img.src = url;
      } catch (_) {
        if (url) {
          try { URL.revokeObjectURL(url); } catch (_) {}
        }
        resolve({ width: 0, height: 0 });
      }
    });
  }

  /**
   * Master function: pick the best extraction strategy for a given File.
   * Returns a token count.
   *
   * @param {File} file
   * @returns {Promise<number>}
   */
  async function extractTokensFromFile(file) {
    const name = (file.name || '').toLowerCase();

    if (looksLikeImageFile(file)) {
      var dims = await getImageDimensions(file);
      var imageTokens = Tokenizer.estimateImageInputTokens(
        dims.width,
        dims.height,
        getActiveImageEstimatorContext()
      );
      if (isDebugEnabled()) console.log('[TokenMeter] image upload estimated Ã¢â€ â€™', imageTokens, 'tokens from',
        file.name, '(' + dims.width + 'x' + dims.height + ')');
      return imageTokens;
    }

    // .docx Ã¢â‚¬â€ mammoth gives us exact plain text
    if (name.endsWith('.docx') || name.endsWith('.docm')) {
      const text = await extractDocxText(file);
      if (text.trim().length > 0) {
        const cleaned = cleanText(text);
        const tokens  = Tokenizer.countTextTokens(cleaned);
        if (isDebugEnabled()) console.log('[TokenMeter] mammoth extracted', cleaned.length,
          'chars Ã¢â€ â€™', tokens, 'tokens from', file.name);
        return tokens;
      }
      // mammoth failed Ã¢â‚¬â€ fall through to size estimate
    }

    // Plain text types Ã¢â‚¬â€ read as text directly
    if (name.match(/\.(txt|md|csv|json|xml|html|htm|js|ts|jsx|tsx|py|java|c|cpp|rs)$/)) {
      const text = await extractPlainText(file);
      if (text.trim().length > 0) {
        const tokens = Tokenizer.countTextTokens(cleanText(text));
        if (isDebugEnabled()) console.log('[TokenMeter] plain text extracted Ã¢â€ â€™', tokens, 'tokens from', file.name);
        return tokens;
      }
    }

    // Binary fallback Ã¢â‚¬â€ conservative size estimate
    const tokens = estimateTokensFromFileSize(file);
    if (isDebugEnabled()) console.log('[TokenMeter] size fallback Ã¢â€ â€™', tokens, 'tokens from',
      file.name, '(' + file.size + ' bytes)');
    return tokens;
  }

  async function extractFileTrackingInfo(file) {
    var info = {
      tokens: 0,
      name: String(file && file.name || 'unknown'),
      size: file && file.size || 0,
      kind: 'file',
      width: 0,
      height: 0,
      estimatorProfile: '',
      modelMode: currentModelMode,
      modelLabel: currentModelLabel,
    };

    if (looksLikeImageFile(file)) {
      var dims = await getImageDimensions(file);
      var estimatorContext = getActiveImageEstimatorContext();
      info.kind = 'image';
      info.width = dims.width || 0;
      info.height = dims.height || 0;
      info.estimatorProfile = (Tokenizer && Tokenizer.getImageEstimatorProfile)
        ? Tokenizer.getImageEstimatorProfile(estimatorContext)
        : '';
      info.modelMode = estimatorContext.mode || '';
      info.modelLabel = estimatorContext.modelLabel || '';
      info.tokens = Tokenizer.estimateImageInputTokens(info.width, info.height, estimatorContext);
      if (isDebugEnabled()) console.log('[TokenMeter] image upload estimated Ã¢â€ â€™', info.tokens, 'tokens from',
        file.name, '(' + info.width + 'x' + info.height + ')',
        'via', info.estimatorProfile || 'default');
      return info;
    }

    info.tokens = await extractTokensFromFile(file);
    return info;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ File input interceptor Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  /**
   * Process a FileList from a file input or drag-drop event.
   * Runs extraction on each file and stores results in fileTokenStore.
   */
  async function processFileList(fileList) {
    if (!fileList || !fileList.length) return;
    attachmentInteractionSeen = true;
    ignoreNetworkUploadsUntil = 0;

    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i];
      var key  = fileKey(file);

      // Skip if already processed this exact file
      if (fileTokenStore[key] !== undefined) continue;

      var info = await extractFileTrackingInfo(file);
      fileTokenStore[key] = info.tokens || 0;
      fileMetaStore[key] = info;
      trackedUploadOrder.push(key);
    }

    // Recompute running total
    totalFileTokens = Object.values(fileTokenStore)
      .reduce(function(acc, t) { return acc + t; }, 0);

    if (isDebugEnabled()) console.log('[TokenMeter] File store updated. Total file tokens:', totalFileTokens);

    // Persist to chrome.storage so tokens survive chat switches and reloads
    saveFileTokens(totalFileTokens);
    scheduleRecalc();
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Persistent storage helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  function safeStorageSet(payload, cb) {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      if (!chrome.runtime || !chrome.runtime.id) return;
      chrome.storage.local.set(payload, function() {
        if (chrome.runtime && chrome.runtime.lastError) return;
        if (typeof cb === 'function') cb();
      });
    } catch (_) {}
  }
  /**
   * Save file token count for the current chat ID.
   * Key format: gtm_files_<chatId>
   * Also writes a timestamp so the 30-day cleanup can expire old entries.
   */
  function saveFileTokens(tokens) {
    if (!currentChatId || tokens <= 0) return;
    var entry = { tokens: tokens, ts: Date.now() };
    var data  = {};
    data['gtm_files_' + currentChatId] = JSON.stringify(entry);
    safeStorageSet(data, function() {
      if (chrome.runtime.lastError) return;
      if (isDebugEnabled()) console.log('[GTM] Tokens saved for chat:', currentChatId, 'Ã¢â€ â€™', tokens);
    });
  }

  function saveHistoryAttachmentTokens(tokens) {
    if (!currentChatId) return;
    if (!tokens || tokens <= 0) {
      try {
        chrome.storage.local.remove(['gtm_history_attach_' + currentChatId], function() {
          if (chrome.runtime && chrome.runtime.lastError) return;
          if (isDebugEnabled()) console.log('[GTM] Cleared history attachment tokens for chat:', currentChatId);
        });
      } catch (_) {}
      return;
    }
    var entry = { tokens: tokens, ts: Date.now() };
    var data  = {};
    data['gtm_history_attach_' + currentChatId] = JSON.stringify(entry);
    safeStorageSet(data, function() {
      if (chrome.runtime.lastError) return;
      if (isDebugEnabled()) console.log('[GTM] History attachment tokens saved for chat:', currentChatId, '->', tokens);
      debugLogOnce('History tokens saved', currentChatId + ':' + tokens, {
        chatId: currentChatId,
        tokens: tokens,
      });
    });
  }

  /**
   * Reset persisted history attachment tokens for the current chat.
   * Called when the user manually clears ghost attachment state via the panel button.
   * Only affects storedHistoryAttachmentTokens and the chrome.storage key Ã¢â‚¬â€
   * does NOT touch fileTokenStore, totalFileTokens, or any other state.
   */
  function clearHistoryAttachmentTokens() {
    storedHistoryAttachmentTokens = 0;
    historyAttachmentLoaded = true;
    if (totalFileTokens <= 0 && networkFallbackTokens <= 0) {
      attachmentInteractionSeen = false;
    }
    if (!currentChatId) { scheduleRecalc(); return; }
    try {
      chrome.storage.local.remove(['gtm_history_attach_' + currentChatId], function() {
        if (chrome.runtime && chrome.runtime.lastError) return;
        scheduleRecalc();
      });
    } catch (_) { scheduleRecalc(); }
  }

  function clearSavedFileTokens(chatId) {
    if (!chatId) return;
    try {
      chrome.storage.local.remove(['gtm_files_' + chatId], function() {
        if (chrome.runtime && chrome.runtime.lastError) return;
        if (isDebugEnabled()) console.log('[GTM] Cleared saved draft tokens for chat:', chatId);
      });
    } catch (_) {}
  }

  /**
   * Load saved file tokens for a given chat ID from chrome.storage.
   * Calls back with the token count (0 if nothing saved).
   * @param {string} chatId
   * @param {function(number)} cb
   */
  function loadFileTokens(chatId, cb) {
    if (!chatId) { cb(0); return; }
    var key = 'gtm_files_' + chatId;
    safeStorageGet([key]).then(function(result) {
      try {
        var raw   = result[key];
        if (!raw) { cb(0); return; }
        var entry = JSON.parse(raw);
        cb(entry.tokens || 0);
      } catch (_) { cb(0); }
    });
  }

  function loadHistoryAttachmentTokens(chatId, cb) {
    if (!chatId) { cb(0); return; }
    var key = 'gtm_history_attach_' + chatId;
    safeStorageGet([key]).then(function(result) {
      try {
        var raw   = result[key];
        if (!raw) { cb(0); return; }
        var entry = JSON.parse(raw);
        debugLogOnce('History tokens loaded', chatId + ':' + (entry.tokens || 0), {
          chatId: chatId,
          tokens: entry.tokens || 0,
        });
        cb(entry.tokens || 0);
      } catch (_) { cb(0); }
    });
  }

  function ensureHistoryAttachmentLoaded(cb) {
    if (historyAttachmentLoaded) {
      cb();
      return;
    }
    loadHistoryAttachmentTokens(currentChatId, function(historyStored) {
      storedHistoryAttachmentTokens = historyStored || 0;
      historyAttachmentLoaded = true;
      cb();
    });
  }
  function isChatDebugEnabled(chatId) {
    if (!chatId) return false;
    var now = Date.now();
    if ((now - lastDebugChatCheckAt) < 2000 && debugChatCacheId == chatId) return debugChatEnabled;
    lastDebugChatCheckAt = now;
    debugChatCacheId = chatId;
    try {
      var raw = localStorage.getItem(DEBUG_CHAT_KEY);
      debugChatEnabled = (raw === '*' || raw === chatId);
    } catch (_) {
      debugChatEnabled = false;
    }
    return debugChatEnabled;
  }

  function isDebugEnabled() {
    if (FORCE_SILENT_LOGS) return false;
    var now = Date.now();
    if ((now - lastDebugFlagCheckAt) < 2000) return debugEnabled;
    lastDebugFlagCheckAt = now;
    try {
      debugEnabled = localStorage.getItem(DEBUG_FLAG_KEY) === '1';
    } catch (_) {
      debugEnabled = false;
    }
    return debugEnabled;
  }

  function isCanvasDebugEnabled() {
    var now = Date.now();
    if ((now - lastDebugCanvasCheckAt) < 2000) return canvasDebugEnabled;
    lastDebugCanvasCheckAt = now;
    try {
      canvasDebugEnabled = localStorage.getItem(DEBUG_CANVAS_KEY) === '1';
    } catch (_) {
      canvasDebugEnabled = false;
    }
    return canvasDebugEnabled;
  }

  function normalizeCanvasCountMode(mode) {
    return String(mode || '').toLowerCase() === 'doc' ? 'doc' : 'code';
  }

  function loadCanvasCountMode() {
    safeStorageGet([CANVAS_COUNT_MODE_KEY]).then(function(result) {
      canvasCountMode = normalizeCanvasCountMode(result[CANVAS_COUNT_MODE_KEY]);
      debugCanvasSnapshot({
        seq: ++canvasDebugSeq,
        event: 'canvas-mode',
        mode: canvasCountMode,
      });
    });
  }

  function setupCanvasCountModeListener() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.onChanged) return;
      chrome.storage.onChanged.addListener(function(changes, areaName) {
        if (areaName !== 'local') return;
        if (!changes || !changes[CANVAS_COUNT_MODE_KEY]) return;
        canvasCountMode = normalizeCanvasCountMode(changes[CANVAS_COUNT_MODE_KEY].newValue);
        canvasLastSignature = '';
        debugCanvasSnapshot({
          seq: ++canvasDebugSeq,
          event: 'canvas-mode',
          mode: canvasCountMode,
        });
        if (canvasRoot) scheduleCanvasScan(canvasRoot, false);
      });
    } catch (_) {}
  }

  function debugLog(label, payload) {
    if (!isDebugEnabled()) return;
    if (typeof payload !== 'undefined') {
      if (isDebugEnabled()) console.log('[TokenMeter]', label, payload);
    } else {
      if (isDebugEnabled()) console.log('[TokenMeter]', label);
    }
  }

  function debugLogOnce(label, signature, payload) {
    if (!isDebugEnabled()) return;
    var key = label + '|' + signature;
    if (debugOnceMap[key]) return;
    debugOnceMap[key] = true;
    debugOnceQueue.push(key);
    if (debugOnceQueue.length > DEBUG_ONCE_MAX) {
      var oldKey = debugOnceQueue.shift();
      if (oldKey) delete debugOnceMap[oldKey];
    }
    debugLog(label, payload);
  }

  function debugCanvasSnapshot(payload) {
    if (!isCanvasDebugEnabled() || !payload) return;
    var signature = '';
    try {
      signature = JSON.stringify(payload);
    } catch (_) {
      signature = String(payload);
    }
    if (signature === lastCanvasDebugSignature) return;
    lastCanvasDebugSignature = signature;
    try { localStorage.setItem('gtm_debug_canvas_payload', signature); } catch (_) {}
    try { window.__gtmCanvasDebug = payload; } catch (_) {}
    console.log('[GTM Canvas Debug]', payload);
  }

  function debugAttachmentSnapshot(payload) {
    if (!isDebugEnabled() || !payload) return;
    var signature = '';
    try {
      signature = JSON.stringify(payload);
    } catch (_) {
      signature = String(payload);
    }
    if (signature === lastAttachmentDebugSignature) return;
    lastAttachmentDebugSignature = signature;
    debugLog('Attachment snapshot:', payload);
  }

  function debugChatSnapshot(payload) {
    if (!payload) return;
    if (!isChatDebugEnabled(currentChatId)) return;
    var signature = '';
    var payloadJson = null;
    try {
      payloadJson = JSON.stringify(payload);
      signature = payloadJson;
    } catch (_) {
      signature = String(payload);
    }
    if (signature === lastChatDebugSignature) return;
    lastChatDebugSignature = signature;
    try { localStorage.setItem('gtm_debug_chat_payload', payloadJson || signature); } catch (_) {}
    try { window.__gtmChatDebug = payload; } catch (_) {}
    console.log('[GTM Chat Debug]', payload);
  }

  function attachBackfillScrollListener() {
    if (!backfillActive) return;

    var target = getChatLogContainer();
    if (!target || target === backfillScrollTarget) return;

    if (backfillScrollTarget && backfillScrollTarget.removeEventListener) {
      backfillScrollTarget.removeEventListener('scroll', onBackfillScroll);
    }

    backfillScrollTarget = target;
    backfillScrollTarget.addEventListener('scroll', onBackfillScroll, { passive: true });
  }

  function onBackfillScroll(e) {
    if (!backfillActive) return;
    if (e && e.target && !isValidDropTarget(e.target)) return;
    var now = Date.now();
    if (now - backfillLastScrollAt < 200) return;
    backfillLastScrollAt = now;
    if (now - backfillLastLogAt > BACKFILL_LOG_INTERVAL_MS) {
      backfillLastLogAt = now;
      debugLog('Backfill scroll', {
        chatId: backfillChatId,
        timeLeftMs: Math.max(0, backfillUntil - now),
      });
    }
    scheduleRecalc();
  }

  function startAttachmentBackfill(chatId) {
    if (!chatId) return;
    backfillActive = true;
    backfillChatId = chatId;
    backfillUntil = Date.now() + BACKFILL_WINDOW_MS;
    debugLog('Backfill start', { chatId: chatId, windowMs: BACKFILL_WINDOW_MS });
    attachBackfillScrollListener();
  }

  function stopAttachmentBackfill() {
    backfillActive = false;
    backfillChatId = '';
    backfillUntil = 0;
    backfillLastScrollAt = 0;
    backfillLastLogAt = 0;
    debugLog('Backfill stop');
    if (backfillScrollTarget && backfillScrollTarget.removeEventListener) {
      backfillScrollTarget.removeEventListener('scroll', onBackfillScroll);
    }
    backfillScrollTarget = null;
  }

  /**
   * Delete storage entries older than 30 days.
   * Called once at init so stale chats don't accumulate indefinitely.
   */
  function purgeOldTokenEntries() {
    try {
      chrome.storage.local.get(null, function(all) {
        if (chrome.runtime.lastError || !all) return;
        var cutoff  = Date.now() - 30 * 24 * 60 * 60 * 1000;
        var toDelete = [];
        Object.keys(all).forEach(function(key) {
          if (!(key.startsWith('gtm_files_') || key.startsWith('gtm_history_attach_'))) return;
          try {
            var entry = JSON.parse(all[key]);
            if (entry.ts && entry.ts < cutoff) toDelete.push(key);
          } catch (_) {}
        });
        if (toDelete.length) {
          chrome.storage.local.remove(toDelete, function() {
            if (isDebugEnabled()) console.log('[GTM] Purged', toDelete.length, 'stale token entries.');
          });
        }
      });
    } catch (_) {}
  }

  /**
   * Attach a change listener to a file <input> element.
   * Called whenever a new input[type=file] is found in the DOM.
   */
  var hookedInputs = new WeakSet();

  function hookFileInput(input) {
    if (hookedInputs.has(input)) return;
    hookedInputs.add(input);

    input.addEventListener('change', async function(e) {
      if (e.target && e.target.files) {
        var filteredFiles = [];
        for (var i = 0; i < e.target.files.length; i++) {
          var file = e.target.files[i];
          if (shouldIgnoreClipboardEcho(file)) {
            if (isDebugEnabled()) console.log('[TokenMeter] Ignoring hidden input echo for pasted image:',
              file.name || getClipboardFingerprint(file));
            continue;
          }
          filteredFiles.push(file);
        }
        if (filteredFiles.length) {
          processFileList(filteredFiles);
        }
      }
    });
  }

  /**
   * Stable selectors for Gemini's actual file upload / drop zone.
   * Deliberately excludes sidebar, nav, and unrelated UI surfaces.
   * Do NOT use long absolute querySelector paths -- they break on minor DOM changes.
   */
  var UPLOAD_ZONE_SELECTOR = [
    '[file-drop-zone]',
    '.xap-uploader-dropzone',
    '.chat-container',
    'file-drop-indicator',
  ].join(', ');

  function isUploadZoneTarget(el) {
    try {
      return !!el.closest(UPLOAD_ZONE_SELECTOR);
    } catch (_) {
      return false;
    }
  }

  /**
   * Returns true when the drop target is inside Gemini's real upload area
   * OR inside the composer (text input / input-area). Either path is
   * legitimate; everything else (sidebar, nav, settings panels, etc.) is not.
   */
  function isValidDropTarget(target) {
    if (!target) return false;

    // Normalise text nodes
    var el = target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    if (!el || !(el instanceof Element)) return false;

    // Path 1: composer / text-input area
    if (isComposerTarget(el)) return true;

    // Path 2: Gemini's dedicated upload / drop-zone elements
    return isUploadZoneTarget(el);
  }

  /**
   * Intercept drag-drop file uploads, but only when the drop lands inside
   * the composer or Gemini's real upload zone -- not anywhere on the page.
   */
  function hookDragDrop() {
    document.addEventListener('drop', function(e) {
      if (!isValidDropTarget(e.target)) return;
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        processFileList(e.dataTransfer.files);
      }
    }, true);  // capture phase so we see it before Gemini's handler
  }

  function isComposerTarget(target) {
    if (!target) return false;

    var el = target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    if (!el || !(el instanceof Element)) return false;

    var draftEl = queryFirst(SELECTORS.draftInput);
    if (draftEl) {
      if (el === draftEl) return true;
      try {
        if (draftEl.contains(el)) return true;
      } catch (_) {}
    }

    try {
      return !!el.closest(
        'rich-textarea, input-area-v2, text-input-v2, .input-area, .input-footer, [data-test-id="bottom-bar"], form'
      );
    } catch (_) {
      return false;
    }
  }

  function getClipboardImageFiles(clipboardData) {
    if (!clipboardData) return [];

    var files = [];
    var seen = Object.create(null);

    function addFile(file) {
      if (!file || !looksLikeImageFile(file)) return;
      var sig = [
        file.name || 'unknown',
        file.size || 0,
        file.lastModified || 0,
        file.type || '',
      ].join('|');
      if (seen[sig]) return;
      seen[sig] = true;
      files.push(file);
    }

    try {
      var items = clipboardData.items || [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item || item.kind !== 'file') continue;
        if (!String(item.type || '').toLowerCase().startsWith('image/')) continue;
        addFile(item.getAsFile ? item.getAsFile() : null);
      }
    } catch (_) {}

    // Some Chromium clipboard flows expose the same pasted image through both
    // clipboardData.items and clipboardData.files, but with different transient
    // metadata. Prefer items when available so a single paste counts once.
    if (files.length) return files;

    try {
      var clipboardFiles = clipboardData.files || [];
      for (var j = 0; j < clipboardFiles.length; j++) {
        addFile(clipboardFiles[j]);
      }
    } catch (_) {}

    return files;
  }

  function hookPaste() {
    document.addEventListener('paste', function(e) {
      if (!e || !isComposerTarget(e.target)) return;

      var imageFiles = getClipboardImageFiles(e.clipboardData);
      if (!imageFiles.length) return;

      rememberRecentClipboardFiles(imageFiles);
      processFileList(imageFiles);
    }, true);
  }

  function getOrderedTrackedUploadKeys() {
    var keys = trackedUploadOrder.filter(function(key) {
      return Object.prototype.hasOwnProperty.call(fileTokenStore, key);
    });

    Object.keys(fileTokenStore).forEach(function(key) {
      if (keys.indexOf(key) === -1) keys.push(key);
    });

    trackedUploadOrder = keys.slice();
    return keys;
  }

  function removeTrackedUploadKey(key, reason) {
    if (!key || !Object.prototype.hasOwnProperty.call(fileTokenStore, key)) return false;
    delete fileTokenStore[key];
    delete fileMetaStore[key];
    trackedUploadOrder = trackedUploadOrder.filter(function(existing) {
      return existing !== key;
    });
    if (isDebugEnabled()) console.log('[TokenMeter] Removed tracked upload from state:',
      key, reason ? '(' + reason + ')' : '');
    return true;
  }

  function getUploadSignature() {
    var keys = getOrderedTrackedUploadKeys();
    if (!keys.length) return '';
    return keys.map(function(key) {
      return key + ':' + (fileTokenStore[key] || 0);
    }).join('|');
  }

  function persistSentAttachments() {
    if (!currentChatId || totalFileTokens <= 0) return;
    var signature = getUploadSignature();
    if (!signature) return;

    var now = Date.now();
    if (signature === lastSentAttachmentSignature &&
        (now - lastSentAttachmentAt) < SENT_ATTACHMENT_DEDUP_MS) {
      return;
    }

    ensureHistoryAttachmentLoaded(function() {
      var nextTotal = (storedHistoryAttachmentTokens || 0) + totalFileTokens;
      storedHistoryAttachmentTokens = nextTotal;
      historyAttachmentLoaded = true;
      lastSentAttachmentSignature = signature;
      lastSentAttachmentAt = now;
      saveHistoryAttachmentTokens(nextTotal);
      debugLogOnce('Persist sent attachments', currentChatId + ':' + signature, {
        chatId: currentChatId,
        tokens: totalFileTokens,
        signature: signature,
        nextTotal: nextTotal,
      });
    });
  }

  function persistPendingSendAttachments() {
    if (!currentChatId || pendingSendAttachmentTokens <= 0) return;
    var signature = pendingSendAttachmentSignature || String(pendingSendAttachmentTokens);
    var now = Date.now();

    if (signature === lastSentAttachmentSignature &&
        (now - lastSentAttachmentAt) < SENT_ATTACHMENT_DEDUP_MS) {
      pendingSendAttachmentTokens = 0;
      pendingSendAttachmentSignature = '';
      pendingSendAttachmentAt = 0;
      return;
    }

    ensureHistoryAttachmentLoaded(function() {
      var nextTotal = (storedHistoryAttachmentTokens || 0) + pendingSendAttachmentTokens;
      storedHistoryAttachmentTokens = nextTotal;
      historyAttachmentLoaded = true;
      lastSentAttachmentSignature = signature;
      lastSentAttachmentAt = now;
      saveHistoryAttachmentTokens(nextTotal);
      debugLogOnce('Persist pending send attachments', currentChatId + ':' + signature, {
        chatId: currentChatId,
        tokens: pendingSendAttachmentTokens,
        signature: signature,
        nextTotal: nextTotal,
      });
      pendingSendAttachmentTokens = 0;
      pendingSendAttachmentSignature = '';
      pendingSendAttachmentAt = 0;
    });
  }

  function getTrackedFileCount() {
    try {
      return getOrderedTrackedUploadKeys().length;
    } catch (_) {
      return 0;
    }
  }

  function flushAttachmentStateAfterRemoval() {
    totalFileTokens = Object.values(fileTokenStore)
      .reduce(function(acc, val) { return acc + val; }, 0);

    if (totalFileTokens > 0) {
      saveFileTokens(totalFileTokens);
    } else if (currentChatId) {
      try { chrome.storage.local.remove(['gtm_files_' + currentChatId]); } catch (_) {}
    }

    // The network fallback is only a safety net for missed uploads. Once the
    // local tracked files are gone and no upload chips remain, clear it so a
    // removed draft attachment cannot keep ghost tokens alive.
    if (getTrackedFileCount() === 0) {
      networkFallbackTokens = 0;
      networkSignalReceived = false;
      attachmentInteractionSeen = false;
      // Gemini sometimes emits a delayed upload signal right after the last
      // draft asset is removed. Briefly suppress those stale echoes.
      ignoreNetworkUploadsUntil = Date.now() + 1500;
    }

    scheduleRecalc();
  }

  function extractRemovedUploadName(cancelBtn) {
    if (!cancelBtn || !(cancelBtn instanceof Element)) return '';

    var ariaLabel = '';
    try { ariaLabel = (cancelBtn.getAttribute('aria-label') || '').trim(); } catch (_) {}
    var lower = ariaLabel.toLowerCase();
    var prefixes = [
      'remove file ',
      'remove image ',
      'remove attachment ',
      'delete file ',
      'delete image ',
      'delete attachment ',
    ];

    for (var i = 0; i < prefixes.length; i++) {
      if (lower.startsWith(prefixes[i])) {
        return ariaLabel.substring(prefixes[i].length).trim().toLowerCase();
      }
    }

    var parentChip = null;
    try {
      parentChip = cancelBtn.closest(
        '[data-test-id="uploaded-file-chip"], file-upload-chip, uploaded-file,' +
        ' .gemini-user-attachment-card, .file-chip, .attachment-chip, .attached-file,' +
        ' attachment-container, .file-attachment, .image-attachment'
      );
    } catch (_) {}

    if (!parentChip) return '';

    var nameEl = null;
    try {
      nameEl = parentChip.querySelector(
        '.file-name-text, [data-name], .upload-file-name, [data-file-name], img[alt]'
      );
    } catch (_) {}

    var extracted = '';
    try {
      extracted = cleanText(
        (nameEl && (
          nameEl.getAttribute('data-name') ||
          nameEl.getAttribute('data-file-name') ||
          nameEl.getAttribute('alt') ||
          nameEl.innerText ||
          nameEl.textContent
        )) || ''
      ).toLowerCase();
    } catch (_) {}

    return extracted;
  }

  function removeTrackedUploadByName(searchName) {
    var normalized = String(searchName || '').trim().toLowerCase();
    if (!normalized) return false;

    var keys = getOrderedTrackedUploadKeys();
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var storeName = (key.split(':')[0] || '').toLowerCase().trim();

      var isMatch = (storeName === normalized) ||
        storeName.includes(normalized) ||
        normalized.includes(storeName) ||
        (normalized.length > 4 && storeName.startsWith(normalized)) ||
        (storeName.length > 4 && normalized.startsWith(storeName));

      if (isMatch) {
        return removeTrackedUploadKey(key, 'name match');
      }
    }

    return false;
  }

  function removeOnlyTrackedUpload(reason) {
    var keys = getOrderedTrackedUploadKeys();

    if (keys.length !== 1) return false;

    return removeTrackedUploadKey(keys[0], reason || 'sole tracked upload');
  }

  function getDraftUploadContainer(anchorEl) {
    var root = null;
    try {
      root = anchorEl && anchorEl.closest && anchorEl.closest(
        'input-area-v2, text-input-v2, .input-area, form, .input-footer, [data-test-id="bottom-bar"]'
      );
    } catch (_) {}

    if (root) return root;

    var selectors = [
      'input-area-v2',
      'text-input-v2',
      '.input-area',
      'form',
      '.input-footer',
      '[data-test-id="bottom-bar"]',
    ];

    for (var i = 0; i < selectors.length; i++) {
      try {
        root = deepQuery(selectors[i], document);
        if (root) return root;
      } catch (_) {}
    }

    return null;
  }

  function getComposerUploadChips(anchorEl) {
    var root = getDraftUploadContainer(anchorEl);
    if (!root) return [];

    var chips = [];
    for (var i = 0; i < ATTACHMENT_CANDIDATE_SELECTORS.length; i++) {
      try {
        chips = chips.concat(deepQueryAll(ATTACHMENT_CANDIDATE_SELECTORS[i], root));
      } catch (_) {}
    }

    return uniqueElements(chips).filter(function(chip) {
      if (!chip || chip.nodeType !== Node.ELEMENT_NODE) return false;
      if (chip.getAttribute('aria-hidden') === 'true' || chip.hidden) return false;
      return isPhysicallyVisible(chip);
    });
  }

  function hasVisibleComposerUploads(anchorEl) {
    if (getComposerUploadChips(anchorEl).length > 0) return true;
    return getComposerImageDescriptors(anchorEl).length > 0;
  }

  function shouldCarryDraftUploadsAcrossChatSwitch() {
    if (!hasVisibleComposerUploads()) return false;
    if (getTrackedFileCount() > 0) return true;
    return !!(attachmentInteractionSeen && (totalFileTokens > 0 || networkFallbackTokens > 0));
  }

  function getComposerImageDescriptors(anchorEl) {
    var root = getDraftUploadContainer(anchorEl);
    if (!root) return [];

    var images = [];
    try {
      images = deepQueryAll(
        '.image-attachment img, .file-attachment img, [data-test-id="uploaded-file-chip"] img, img[src^="blob:"], img[src^="data:"]',
        root
      );
    } catch (_) {}

    var descriptors = [];
    uniqueElements(images).forEach(function(img) {
      if (!img || img.nodeType !== Node.ELEMENT_NODE) return;
      if (!isPhysicallyVisible(img)) return;

      var dims = { width: 0, height: 0 };
      try {
        var rect = img.getBoundingClientRect();
        dims = {
          width: Math.max(img.naturalWidth || 0, Math.round(rect.width || 0)),
          height: Math.max(img.naturalHeight || 0, Math.round(rect.height || 0)),
        };
      } catch (_) {}

      if (!dims.width || !dims.height) return;

      descriptors.push({
        width: dims.width,
        height: dims.height,
        tokens: Tokenizer.estimateImageInputTokens(dims.width, dims.height),
      });
    });

    return descriptors;
  }

  function matchTrackedImageKey(descriptor, candidateKeys) {
    if (!descriptor || !candidateKeys || !candidateKeys.length) return '';

    var exactTokenKey = '';
    var bestKey = '';
    var bestScore = Infinity;

    for (var i = 0; i < candidateKeys.length; i++) {
      var key = candidateKeys[i];
      var meta = fileMetaStore[key];
      if (!meta || meta.kind !== 'image') continue;

      if (meta.width === descriptor.width && meta.height === descriptor.height) {
        return key;
      }

      if (meta.tokens === descriptor.tokens && !exactTokenKey) {
        exactTokenKey = key;
      }

      var score = Math.abs((meta.tokens || 0) - (descriptor.tokens || 0));
      score += Math.abs((meta.width || 0) - descriptor.width) / 1000;
      score += Math.abs((meta.height || 0) - descriptor.height) / 1000;

      if (score < bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }

    if (exactTokenKey) return exactTokenKey;
    return bestScore <= 2 ? bestKey : '';
  }

  function reconcileTrackedDraftImages(anchorEl) {
    var imageKeys = getOrderedTrackedUploadKeys().filter(function(key) {
      var meta = fileMetaStore[key];
      return !!(meta && meta.kind === 'image');
    });

    if (!imageKeys.length) return false;

    var remaining = getComposerImageDescriptors(anchorEl);
    if (remaining.length === imageKeys.length) return false;

    var unmatched = imageKeys.slice();
    for (var i = 0; i < remaining.length; i++) {
      var matchedKey = matchTrackedImageKey(remaining[i], unmatched);
      if (!matchedKey) continue;
      unmatched = unmatched.filter(function(key) { return key !== matchedKey; });
    }

    if (!unmatched.length) return false;

    unmatched.forEach(function(key) {
      removeTrackedUploadKey(key, 'composer image reconcile');
    });

    flushAttachmentStateAfterRemoval();
    return true;
  }

  function scheduleDraftImageReconcile(anchorEl) {
    setTimeout(function() {
      try { reconcileTrackedDraftImages(anchorEl); } catch (_) {}
    }, 80);
  }

  // Keep DOM removals and our state in sync (Fix: "Context Drift")
  function hookFileRemoval() {
    document.addEventListener('click', function(e) {
      // Use composedPath so we can survive Shadow DOM + SPA render churn.
      var path = e && (e.composedPath ? e.composedPath() : (e.path || [e.target]));
      if (!path || !path.length) return;

      var chipSelectors;
      try {
        chipSelectors = (SELECTORS && SELECTORS.attachmentChip && SELECTORS.attachmentChip.length)
          ? SELECTORS.attachmentChip.join(', ')
          : [
              '.file-chip', '.attachment-chip', 'file-upload-chip',
              '.file-attachment', 'uploaded-file', 'attachment-container',
            ].join(', ');
      } catch (_) {
        chipSelectors = [
          '.file-chip', '.attachment-chip', 'file-upload-chip',
          '.file-attachment', 'uploaded-file', 'attachment-container',
        ].join(', ');
      }

      var clickedBtn = null;
      var parentChip = null;

      for (var i = 0; i < path.length; i++) {
        var node = path[i];
        if (!node || !(node instanceof Element)) continue;

        if (!clickedBtn) {
          try {
            clickedBtn = node.closest(
              'button, [role="button"], md-icon-button, .remove-btn,' +
              ' [aria-label*="emove"], [aria-label*="elete"], [aria-label*="lear"]'
            );
          } catch (_) {}
        }

        if (clickedBtn && !parentChip) {
          try { parentChip = clickedBtn.closest(chipSelectors); } catch (_) {}
        }

        if (parentChip) break;
      }

      if (!clickedBtn || !parentChip) return;

      var extractedName = extractRemovedUploadName(clickedBtn);
      if (extractedName && removeTrackedUploadByName(extractedName)) {
        flushAttachmentStateAfterRemoval();
        return;
      }

      // Extract visible filename (often truncated by UI)
      var nameEl = null;
      try { nameEl = parentChip.querySelector('.file-name-text, [data-name], .upload-file-name'); } catch (_) {}
      if (!nameEl) nameEl = parentChip;

      var visibleName = (nameEl.innerText || nameEl.textContent || '').trim().toLowerCase();
      var searchName = visibleName.replace(/\.+$/, '').trim();
      if (!searchName) {
        scheduleDraftImageReconcile(clickedBtn);
        return;
      }

      // Fuzzy subset matching: UI may show a truncated prefix like "report..."
      var storeUpdated = removeTrackedUploadByName(searchName);

      if (!storeUpdated) {
        scheduleDraftImageReconcile(clickedBtn);
        return;
      }

      flushAttachmentStateAfterRemoval();
    }, true);
  }

  // Angular-specific file removal: use cancel button aria-label for exact filename
  function hookFileRemovalAngular() {
    document.addEventListener('click', function(e) {
      var target = e && e.target;
      if (!target || !(target instanceof Element)) return;

      // 1. Find the specific cancel button using data-test-id or class
      var cancelBtn =
        target.closest('[data-test-id="cancel-button"]') ||
        target.closest('.cancel-button') ||
        target.closest('button[aria-label*="Remove"], button[aria-label*="Delete"]');
      if (!cancelBtn) return;

      // 2. Extract the exact asset name from the aria-label ("Remove file [NAME]"
      // or "Remove image [NAME]").
      var extractedFileName = extractRemovedUploadName(cancelBtn);
      var storeUpdated = extractedFileName
        ? removeTrackedUploadByName(extractedFileName)
        : false;

      // Single-image preview cards do not always expose a stable filename.
      if (!storeUpdated) {
        storeUpdated = removeOnlyTrackedUpload('sole cancel-button fallback');
      }

      if (!storeUpdated) {
        scheduleDraftImageReconcile(cancelBtn);
        return;
      }

      // 4. Flush State and Trigger Recalculation
      flushAttachmentStateAfterRemoval();
    }, true); // capture phase required before Angular destroys the DOM node
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Dynamic context limit (plan/model detection) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  var planDetectTimer = null;
  var planRetryTimer = null;
  var lastPlanDetectHref = '';
  var localTabTier = '';
  var PLAN_RETRY_DELAYS_MS = [0, 350, 1200];

  function normalizePlanTier(value) {
    var tier = String(value || '').trim().toLowerCase();
    if (tier === 'free') return 'Free';
    if (tier === 'plus') return 'Plus';
    if (tier === 'pro') return 'Pro';
    if (tier === 'ultra') return 'Ultra';
    return '';
  }

  function isKnownPlanTier(tier) {
    return tier === 'Free' || tier === 'Plus' || tier === 'Pro' || tier === 'Ultra';
  }

  function isPaidPlanTier(tier) {
    return tier === 'Plus' || tier === 'Pro' || tier === 'Ultra';
  }

  function setPlanDetectionState(tier, confidence, source) {
    var normalizedTier = normalizePlanTier(tier);
    currentPlanTier = normalizedTier || 'Unknown';
    currentPlanTierConfidence = String(confidence || 'low');
    currentPlanTierSource = String(source || 'unknown');
    if (normalizedTier) {
      localTabTier = normalizedTier;
    }
  }

  function getPlanSignalText(selectors, preferDeepQuery) {
    if (!selectors || !selectors.length) return '';

    for (var i = 0; i < selectors.length; i++) {
      var sel = selectors[i];
      var el = null;

      if (preferDeepQuery && typeof deepQuery === 'function') {
        try { el = deepQuery(sel, document); } catch (_) {}
      }

      if (!el) {
        try { el = document.querySelector(sel); } catch (_) {}
      }
      if (!el) continue;

      var text = '';
      try {
        text = String(
          el.innerText ||
          el.textContent ||
          ((typeof el.getAttribute === 'function') ? (el.getAttribute('aria-label') || '') : '') ||
          ''
        ).trim().toLowerCase();
      } catch (_) {
        text = '';
      }
      if (text) return text;
    }
    return '';
  }

  function tierFromProfileText(text) {
    var t = String(text || '').toLowerCase();
    if (!t) return '';

    if (t.includes('google ai ultra') || t.includes('ai ultra') || /\bultra\b/.test(t)) return 'Ultra';
    if (t.includes('google ai pro') || t.includes('ai pro') || /\bpro\b/.test(t)) return 'Pro';
    if (t.includes('google ai premium') || t.includes('ai premium') ||
        /\badvanced\b/.test(t) || /\bpremium\b/.test(t) || /\bplus\b/.test(t)) return 'Plus';
    if (/\bfree\b/.test(t)) return 'Free';
    return '';
  }

  function tierFromPillboxText(text) {
    var t = String(text || '').toLowerCase();
    if (!t) return '';

    // Pillbox often carries model labels, so keep this parsing stricter.
    if (t.includes('google ai ultra') || t.includes('ai ultra') || t.includes('ultra plan')) return 'Ultra';
    if (t.includes('google ai pro') || t.includes('ai pro') || t.includes('pro plan')) return 'Pro';
    if (/\badvanced\b/.test(t) || /\bpremium\b/.test(t) || /\bplus\b/.test(t)) return 'Plus';
    if (t.includes('free plan') || t.includes('google ai free')) return 'Free';
    return '';
  }

  function tierFromModelText(text) {
    var t = String(text || '').toLowerCase();
    if (!t) return '';

    // Model signal is corroborative only; it can confirm paid tiers but never Free.
    if (/\bultra\b/.test(t)) return 'Ultra';
    if (t.includes('2.5 pro') || t.includes('3.1 pro') || t.includes('3 pro') || /\bpro\b/.test(t)) return 'Pro';
    if (/\badvanced\b/.test(t)) return 'Plus';
    return '';
  }

  function hasGenericUpgradeSignal(text) {
    var t = String(text || '').toLowerCase();
    if (!t || !t.includes('upgrade')) return false;
    var hasPlanLabel =
      t.includes('ai pro') ||
      t.includes('ai ultra') ||
      t.includes('ai premium') ||
      t.includes('advanced') ||
      t.includes('premium') ||
      t.includes('plus') ||
      t.includes('ultra');
    return !hasPlanLabel;
  }

  function resolvePlanTier(signals) {
    var fromProfile = tierFromProfileText(signals.profileText);
    if (fromProfile) {
      return { tier: fromProfile, confidence: 'high', source: 'profile' };
    }

    var fromPillbox = tierFromPillboxText(signals.pillboxText);
    if (fromPillbox) {
      return { tier: fromPillbox, confidence: 'medium', source: 'pillbox' };
    }

    if (isPaidPlanTier(signals.cachedTier)) {
      return { tier: signals.cachedTier, confidence: 'cached', source: 'cache-paid' };
    }

    var fromModel = tierFromModelText(signals.modelText);
    if (fromModel) {
      return { tier: fromModel, confidence: 'medium', source: 'model' };
    }

    var hasGenericUpgrade =
      hasGenericUpgradeSignal(signals.upsellText) ||
      hasGenericUpgradeSignal(signals.pillboxText);
    if (hasGenericUpgrade) {
      return { tier: 'Unknown', confidence: 'low', source: 'generic-upgrade' };
    }

    if (signals.cachedTier === 'Free') {
      return { tier: 'Free', confidence: 'low', source: 'cache-free' };
    }

    return { tier: 'Unknown', confidence: 'low', source: 'no-signal' };
  }

  function inferGeminiMode(modelName, isDeepThink) {
    var label = String(modelName || '').toLowerCase();

    if (isDeepThink || label.includes('deep think')) return 'deep-think';
    if (label.includes('thinking')) return 'thinking';
    if (label.includes('pro') || label.includes('3.1')) return 'pro';
    if (label.includes('fast') || label.includes('flash')) return 'fast';
    return '';
  }

  function applyLimitFromPlan(planName, isDeepThink) {
    var plan = String(planName || '').trim();
    var newLimit = 32000; // Free default

    if (plan === 'Ultra') {
      // Deep Think mode uses the strict 192k limit requirement
      newLimit = isDeepThink ? 192000 : 1000000;
    } else if (plan === 'Pro') {
      newLimit = 1000000;
    } else if (plan === 'Plus') {
      newLimit = 128000;
    }

    if (Tokenizer.CONTEXT_LIMIT !== newLimit) {
      try {
        Tokenizer.updateContextLimit(newLimit);
        if (isDebugEnabled()) console.log('[TokenMeter] Plan detected as:', plan || 'Free', '| Capacity toggled to:', newLimit);
      } catch (_) {}
      scheduleRecalc();
    }
  }

  function detectAndUpdatePlan() {
    if (document.hidden) return;
    if (typeof Tokenizer === 'undefined' || !Tokenizer || typeof Tokenizer.updateContextLimit !== 'function') {
      return;
    }

    safeStorageGet(['manual_plan_override', 'gtm_cached_tier']).then(function(result) {
      var overrideRaw = (result && result.manual_plan_override) ? String(result.manual_plan_override) : '';
      var overrideTier = normalizePlanTier(overrideRaw);
      var cachedTier = normalizePlanTier(localTabTier || ((result && result.gtm_cached_tier) ? String(result.gtm_cached_tier) : ''));

      var pillboxText = getPlanSignalText([
        '[data-test-id="pillbox"]',
        '.pillbox',
      ], false);

      var modelName = getPlanSignalText([
        '.model-selector-button',
        '[data-model-name]',
        '.model-name',
        '[data-test-id="model-switcher-trigger"]',
      ], false);

      var profileText = getPlanSignalText([
        'button[aria-label*="Google Account"]',
        'img[alt*="Profile picture"]',
        '[data-test-id="account-button"]',
        '[class*="AccountSwitcher"]',
      ], true);

      var upsellText = getPlanSignalText([
        '.upsell-label',
        '[class*="upsell"]',
        '[data-test-id="upgrade-button"]',
        'button[aria-label*="upgrade" i]',
      ], false);

      var isDeepThink = false;
      try {
        isDeepThink = !!document.querySelector('[data-deep-think="true"]') ||
          modelName.includes('deep think') || modelName.includes('think') || modelName.includes('3.1');
      } catch (_) {}

      if (modelName) currentModelLabel = modelName;
      var inferredMode = inferGeminiMode(modelName, isDeepThink);
      if (inferredMode) currentModelMode = inferredMode;

      if (overrideRaw && overrideRaw.toLowerCase() !== 'auto' && overrideTier) {
        setPlanDetectionState(overrideTier, 'manual', 'manual-override');
        applyLimitFromPlan(overrideTier, isDeepThink);
        scheduleRecalc();
        return;
      }

      var resolution = resolvePlanTier({
        cachedTier: cachedTier,
        pillboxText: pillboxText,
        modelText: modelName,
        profileText: profileText,
        upsellText: upsellText,
      });

      var resolvedTier = normalizePlanTier(resolution.tier);
      var resolvedConfidence = String(resolution.confidence || 'low');
      var resolvedSource = String(resolution.source || 'unknown');

      // Never evict a paid cache from low-confidence or ambiguous detections.
      if (isPaidPlanTier(cachedTier) && (!resolvedTier || resolvedConfidence === 'low')) {
        resolvedTier = cachedTier;
        resolvedConfidence = 'cached';
        resolvedSource = 'downgrade-blocked';
      }

      // Persist only trusted detections so generic UI text changes do not poison cache.
      if (!document.hidden && isKnownPlanTier(resolvedTier) && resolvedConfidence === 'high') {
        safeStorageSet({ 'gtm_cached_tier': resolvedTier });
      }

      setPlanDetectionState(resolvedTier, resolvedConfidence, resolvedSource);
      var hasPaidCache = isPaidPlanTier(cachedTier);
      var shouldFallbackToFree =
        !hasPaidCache &&
        (!resolvedTier || (resolvedTier === 'Free' && resolvedConfidence === 'low'));
      var limitTier = '';

      if (isKnownPlanTier(resolvedTier)) {
        limitTier = resolvedTier;
      } else if (shouldFallbackToFree) {
        // Conservative baseline for no-signal/no-cache states.
        limitTier = 'Free';
      }

      if (limitTier) {
        applyLimitFromPlan(limitTier, isDeepThink);
      } else if (isDebugEnabled()) {
        console.log('[TokenMeter] Plan tier ambiguous. Keeping existing context limit.', {
          tier: resolvedTier || 'Unknown',
          source: resolvedSource,
          confidence: resolvedConfidence,
        });
      }

      scheduleRecalc();
    });
  }

  function stopPlanDetectionTimers() {
    if (planDetectTimer) {
      clearTimeout(planDetectTimer);
      planDetectTimer = null;
    }
    if (planRetryTimer) {
      clearTimeout(planRetryTimer);
      planRetryTimer = null;
    }
  }

  function queuePlanDetection(delayMs) {
    if (document.hidden) return;
    if (planDetectTimer) clearTimeout(planDetectTimer);
    planDetectTimer = setTimeout(function() {
      planDetectTimer = null;
      detectAndUpdatePlan();
    }, Math.max(0, delayMs || 0));
  }

  function schedulePlanDetectionBurst() {
    stopPlanDetectionTimers();
    if (document.hidden) return;

    var idx = 0;
    function runNext() {
      if (document.hidden || idx >= PLAN_RETRY_DELAYS_MS.length) {
        planRetryTimer = null;
        return;
      }

      var delay = PLAN_RETRY_DELAYS_MS[idx++];
      queuePlanDetection(delay);
      var followUpDelay = delay + 80;
      planRetryTimer = setTimeout(runNext, followUpDelay);
    }

    runNext();
  }

  function handleVisibilityPlanRefresh() {
    if (document.visibilityState === 'visible') {
      schedulePlanDetectionBurst();
      scheduleRecalc();
    } else {
      stopPlanDetectionTimers();
    }
  }

  /**
   * Scan the full DOM (including shadow roots) for file inputs and hook them.
   * Called on MutationObserver triggers and at init.
   */
  function scanAndHookFileInputs(root) {
    root = root || document;
    try {
      var inputs = root.querySelectorAll('input[type="file"]');
      for (var i = 0; i < inputs.length; i++) hookFileInput(inputs[i]);
    } catch (_) {}

    // Also pierce shadow roots
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    var node = walker.nextNode();
    while (node) {
      if (node.shadowRoot) {
        try {
          var shadowInputs = node.shadowRoot.querySelectorAll('input[type="file"]');
          for (var j = 0; j < shadowInputs.length; j++) hookFileInput(shadowInputs[j]);
        } catch (_) {}
        scanAndHookFileInputs(node.shadowRoot);
      }
      node = walker.nextNode();
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Draft state Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //
  // draftFrozen: set to true the moment the user sends a message.
  //   While frozen, recalculate() returns 0 for draftTokens regardless of
  //   what the DOM says (streaming response mutates the input area transiently).
  //   Unfreezes once the input element is confirmed empty after the send.
  //
  var draftFrozen = false;
  var API_THROTTLE_MS = 10000;
  var lastConversationApiSignature = '';
  var lastConversationExactCounts  = null;
  var lastConversationApiAt        = 0;
  var conversationApiPromise       = null;
  var conversationApiPromiseSignature = '';
  var lastDraftApiSignature        = '';
  var lastDraftExactTokens         = 0;
  var lastDraftApiAt               = 0;
  var draftApiPromise              = null;
  var draftApiPromiseSignature     = '';

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ SPA URL / chat-change detection (Fix #1) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //
  // Gemini is a single-page app. Navigating between chats changes the URL
  // (e.g. /app/08984b... Ã¢â€ â€™ /app/1a2b3c...) without a page reload.
  // We track the chat ID segment and reset all per-conversation state when it
  // changes, then immediately re-scan visible history for the new chat.

  var currentChatId = '';

  /**
   * Extract the current conversation identity from the URL.
   *
   * Supported patterns:
   *   /app/[CHAT_ID]
   *   /u/N/app/[CHAT_ID]
   *   /gem/[GEM_ID]/[CHAT_ID]
   *   /u/N/gem/[GEM_ID]/[CHAT_ID]
   *
   * Returns '' for zero-state routes such as:
   *   /app
   *   /u/N/app
   *   /gem/[GEM_ID]
   *   /u/N/gem/[GEM_ID]
   *
   */
  function getChatIdFromUrl() {
    var path = window.location.pathname || '';

    var appMatch = path.match(/\/app\/([a-f0-9]+)/i);
    if (appMatch) return appMatch[1];

    var gemMatch = path.match(/\/gem\/([^\/?#]+)\/([^\/?#]+)/i);
    if (gemMatch) {
      return gemMatch[2];
    }

    return '';
  }

  /**
   * Reset all per-conversation accumulators.
   * Called every time the chat ID in the URL changes.
   */
  function resetChatState(options) {
    var preserveDraftUploads = !!(options && options.preserveDraftUploads);
    if (isDebugEnabled()) console.log(
      preserveDraftUploads
        ? '[TokenMeter] Chat changed Ã¢â‚¬â€ resetting conversation state while preserving live draft uploads.'
        : '[TokenMeter] Chat changed Ã¢â‚¬â€ resetting state.'
    );

    if (!preserveDraftUploads) {
      fileTokenStore        = {};
      fileMetaStore         = {};
      trackedUploadOrder    = [];
      totalFileTokens       = 0;
      attachmentInteractionSeen = false;
      networkFallbackTokens = 0;
      networkSignalReceived = false;
      ignoreNetworkUploadsUntil = 0;
    }

    storedHistoryAttachmentTokens = 0;
    historyAttachmentLoaded = false;
    lastSentAttachmentSignature = '';
    lastSentAttachmentAt = 0;
    pendingDraftAttachmentTokens = 0;
    pendingDraftAttachmentSignature = '';
    lastUserTurnCount = 0;
    pendingSendAttachmentTokens = 0;
    pendingSendAttachmentSignature = '';
    pendingSendAttachmentAt = 0;
    stopAttachmentBackfill();

    lastMeterBreakdown    = null;
    lastAttachmentSourceWarning = '';
    draftFrozen           = false;
    serverTokenCount      = null;   // clear any cached server metadata
    lastConversationApiSignature = '';
    lastConversationExactCounts  = null;
    lastConversationApiAt        = 0;
    conversationApiPromise       = null;
    conversationApiPromiseSignature = '';
    lastDraftApiSignature        = '';
    lastDraftExactTokens         = 0;
    lastDraftApiAt               = 0;
    draftApiPromise              = null;
    draftApiPromiseSignature     = '';
    if (canvasObserver) {
      try { canvasObserver.disconnect(); } catch (_) {}
      canvasObserver = null;
    }
    canvasRoot = null;
    canvasTokens = 0;
    canvasLastSignature = '';
    canvasMonacoText = '';
    canvasMonacoLastAt = 0;
    canvasTextSource = 'none';

    // Immediately re-scan visible history
    updateMeterBreakdown(null);
    scheduleRecalc();
  }

  /**
   * Check if the URL has changed and handle the transition.
   * Called from the MutationObserver and the History API patches.
   */
  function checkUrlChange() {
    var href = window.location.href;
    if (href !== lastPlanDetectHref) {
      lastPlanDetectHref = href;
      schedulePlanDetectionBurst();
    }

    var newId = getChatIdFromUrl();
    if (newId !== currentChatId) {
      var previousChatId = currentChatId;
      var isInitialChatSave = (currentChatId === '' && newId !== '');
      var carryDraftUploads = !isInitialChatSave && shouldCarryDraftUploadsAcrossChatSwitch();
      currentChatId = newId;

      if (isInitialChatSave) {
        // New chat just got its ID assigned Ã¢â‚¬â€ preserve all tokens in memory
        // and also persist them now that we have a real chat ID to key on.
        if (isDebugEnabled()) console.log('[GTM] Chat ID assigned. Keeping current tokens.');
        saveFileTokens(totalFileTokens);
        persistPendingSendAttachments();
        scheduleRecalc();
      } else {
        // Switching to a different chat Ã¢â‚¬â€ reset RAM, then restore from storage
        // in case this is a chat we visited before that had file uploads.
        if (isDebugEnabled()) console.log('[GTM] Switched chats.',
          carryDraftUploads
            ? 'Preserving current composer uploads.'
            : 'Resetting draft upload state for destination chat.'
        );
        resetChatState({ preserveDraftUploads: carryDraftUploads });

        if (carryDraftUploads) {
          if (previousChatId && previousChatId !== newId) {
            clearSavedFileTokens(previousChatId);
          }
          if (newId && totalFileTokens > 0) {
            saveFileTokens(totalFileTokens);
          }
          scheduleRecalc();
          return;
        }

        loadFileTokens(newId, function(stored) {
          if (stored > 0) {
            totalFileTokens = stored;
            attachmentInteractionSeen = true;
            if (isDebugEnabled()) console.log('[GTM] Restored tokens from storage:', stored);
          }
          loadHistoryAttachmentTokens(newId, function(historyStored) {
            storedHistoryAttachmentTokens = historyStored || 0;
            historyAttachmentLoaded = true;
            if (storedHistoryAttachmentTokens > 0) {
              if (isDebugEnabled()) console.log('[GTM] Restored history attachment tokens:', storedHistoryAttachmentTokens);
            } else {
              startAttachmentBackfill(newId);
            }
            scheduleRecalc();
          });
        });
      }
    }
  }

  /**
   * Patch History API pushState / replaceState so we catch SPA navigations
   * that don't fire a hashchange or popstate event.
   */
  (function patchHistory() {
    var _push    = history.pushState.bind(history);
    var _replace = history.replaceState.bind(history);

    history.pushState = function() {
      _push.apply(history, arguments);
      setTimeout(checkUrlChange, 50);
    };
    history.replaceState = function() {
      _replace.apply(history, arguments);
      setTimeout(checkUrlChange, 50);
    };

    window.addEventListener('popstate', function() { setTimeout(checkUrlChange, 50); });
    window.addEventListener('hashchange', function() { setTimeout(checkUrlChange, 50); });
  })();

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Server token metadata cache (for Thinking mode) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //
  // background.js parses Gemini's streaming response JSON and extracts
  // usageMetadata.totalTokenCount + thoughtsTokenCount.
  // When available, these exact counts override the DOM-scraped totals.

  var serverTokenCount = null;  // { total, thoughts, prompt } or null

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Network signal from background.js Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  //
  // background.js sends GTM_FILE_UPLOAD_DETECTED when it sees a large binary POST.
  // We use this as a safety net ONLY Ã¢â‚¬â€ if the file interceptor already ran and
  // stored a mammoth-extracted count for this file, we do NOT add more tokens.
  //
  // If the file interceptor somehow missed the file (e.g. programmatic upload),
  // we use bytes / 20 as a conservative fallback.
  //

  var networkSignalReceived = false;
  var networkFallbackTokens = 0;
  var ignoreNetworkUploadsUntil = 0;

  chrome.runtime.onMessage.addListener(function(message) {
    if (!message) return;

    // Server-side exact token counts (from Thinking mode response metadata)
    if (message.type === 'GTM_SERVER_TOKENS') {
      serverTokenCount = {
        total:    message.totalTokens   || 0,
        thoughts: message.thoughtTokens || 0,
        prompt:   message.promptTokens  || 0,
      };
      if (isDebugEnabled()) console.log('[TokenMeter] Server token count received:',
        serverTokenCount.total, 'total,', serverTokenCount.thoughts, 'thought tokens,',
        serverTokenCount.prompt, 'prompt tokens');
      scheduleRecalc();
      return;
    }

    if (message.type !== 'GTM_FILE_UPLOAD_DETECTED') return;

    if (Date.now() < ignoreNetworkUploadsUntil && getTrackedFileCount() === 0) {
      if (isDebugEnabled()) console.log('[TokenMeter] Ignoring late network upload signal right after removal.');
      return;
    }

    if (!attachmentInteractionSeen && totalFileTokens === 0 && !hasConfirmedUploadChipAnywhere()) {
      if (isDebugEnabled()) console.log('[TokenMeter] Ignoring network upload signal without local attachment evidence.');
      return;
    }

    networkSignalReceived = true;

    // Use the pre-computed estimate from background.js (already deflated correctly).
    // If mammoth also ran, we take the maximum Ã¢â‚¬â€ mammoth is more accurate for .docx
    // but the network estimate is the only signal for non-.docx binary files.
    var networkEst = message.estimatedTokens || 0;

    if (networkEst > 0) {
      networkFallbackTokens = Math.max(networkFallbackTokens, networkEst);
      if (isDebugEnabled()) console.log('[TokenMeter] Network estimate:', networkEst, 'tokens',
        '(class:', message.payloadClass + ').',
        'Mammoth total:', totalFileTokens,
        'Ã¢â€ â€™ will use:', Math.max(totalFileTokens, networkFallbackTokens));
    }

    scheduleRecalc();
  });

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ cleanText (markdown / entity / zero-width stripping) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  function cleanText(raw) {
    if (!raw || typeof raw !== 'string') return '';
    var t = raw;
    t = t.replace(/^```[\w]*\n?/gm, '').replace(/^```$/gm, '');
    t = t.replace(/`([^`]*)`/g, '$1');
    t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
    t = t.replace(/(\*|_)(.*?)\1/g,    '$2');
    t = t.replace(/~~(.*?)~~/g,         '$1');
    t = t.replace(/^#{1,6}\s+/gm, '');
    t = t.replace(/^[-*_]{3,}\s*$/gm, '');
    t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
    t = t.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
         .replace(/&nbsp;/g,' ').replace(/&quot;/g,'"').replace(/&#?\w+;/g,' ');
    t = t.replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/g, '');
    t = t.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    t = t.replace(/\n{3,}/g,'\n\n');
    t = t.replace(/[ \t]+/g,' ');
    return t.replace(/^\s+|\s+$/g,'');
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Shadow DOM helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  function deepQuery(selector, root) {
    root = root || document;
    try { var f = root.querySelector(selector); if (f) return f; } catch (_) {}
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    var node = walker.nextNode();
    while (node) {
      if (node.shadowRoot) { var r = deepQuery(selector, node.shadowRoot); if (r) return r; }
      node = walker.nextNode();
    }
    return null;
  }

  function deepQueryAll(selector, root) {
    root = root || document;
    var results = [];
    try { results = results.concat(Array.from(root.querySelectorAll(selector))); } catch (_) {}
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    var node = walker.nextNode();
    while (node) {
      if (node.shadowRoot) results = results.concat(deepQueryAll(selector, node.shadowRoot));
      node = walker.nextNode();
    }
    return results;
  }

  function uniqueElements(nodes) {
    var seen = new Set();
    var unique = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node || seen.has(node)) continue;
      seen.add(node);
      unique.push(node);
    }
    return unique;
  }

  var SKIP_TAGS = new Set([
    'script','style','noscript','head','meta','link',
    'button','svg','path','canvas','iframe',
    'input-area-v2','input-footer','action-buttons',
    'side-navigation-v2','bard-sidenav-item',
  ]);

  function deepExtractText(root) {
    if (!root) return '';
    var parts = [];
    function walk(node) {
      if (node.shadowRoot) walk(node.shadowRoot);
      var children = node.childNodes;
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child.nodeType === Node.TEXT_NODE) {
          var raw = child.textContent || '';
          if (raw.trim()) parts.push(raw);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          var tag = (child.tagName || '').toLowerCase();
          if (SKIP_TAGS.has(tag)) continue;
          if (child.getAttribute('aria-hidden') === 'true') continue;
          try {
            var cs = window.getComputedStyle(child);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          } catch (_) {}
          if (child.shadowRoot) walk(child.shadowRoot);
          walk(child);
        }
      }
    }
    walk(root);
    return cleanText(parts.join(' '));
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Standard helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  function queryFirst(selectorList, root) {
    root = root || document;
    for (var i = 0; i < selectorList.length; i++) {
      try { var el = root.querySelector(selectorList[i]); if (el) return el; } catch (_) {}
    }
    return null;
  }

  function queryAll(selectorList, root) {
    root = root || document;
    var results = [];
    var seen = new Set();
    for (var i = 0; i < selectorList.length; i++) {
      try {
        var els = root.querySelectorAll(selectorList[i]);
        for (var j = 0; j < els.length; j++) {
          if (seen.has(els[j])) continue;
          seen.add(els[j]);
          results.push(els[j]);
        }
      } catch (_) {}
    }
    return results;
  }

  function extractTurnText(turnEl) {
    for (var i = 0; i < SELECTORS.turnText.length; i++) {
      try {
        var el = deepQuery(SELECTORS.turnText[i], turnEl);
        if (el) {
          var cleaned = cleanText(el.innerText || el.textContent || '');
          if (cleaned.length > 20) return cleaned;
        }
      } catch (_) {}
    }
    return deepExtractText(turnEl);
  }

  function extractThinkingTokens(turnEl) {
    // Ã¢â€â‚¬Ã¢â€â‚¬ Strategy 1: DOM attribute with exact count Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    for (var i = 0; i < SELECTORS.thinkingSection.length; i++) {
      try {
        var el = deepQuery(SELECTORS.thinkingSection[i], turnEl);
        if (!el) continue;
        var attr = el.getAttribute('thoughts_token_count')
                || el.getAttribute('data-thinking-tokens')
                || el.getAttribute('data-thought-tokens');
        if (attr) return parseInt(attr, 10) || 0;
      } catch (_) {}
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Strategy 2: Scrape collapsed thinking section text Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    // Gemini renders <details> or a collapsible wrapper for the "Thoughts" block.
    // The text is present in the DOM even when the section is visually collapsed.
    var thinkingContainers = deepQueryAll([
      'thought-chunk',
      '.thoughts-container',
      '[data-thought-process]',
      'details.thinking',
      '.thinking-process',
      '[aria-label*="Thinking"]',
      '[aria-label*="thought"]',
    ].join(','), turnEl);

    var combinedText = '';
    for (var j = 0; j < thinkingContainers.length; j++) {
      var raw = thinkingContainers[j].innerText
             || thinkingContainers[j].textContent
             || '';
      combinedText += ' ' + raw;
    }

    combinedText = cleanText(combinedText);
    if (combinedText.length > 10) {
      return Tokenizer.countTextTokens(combinedText);
    }

    return 0;
  }

  function getImageDimensionsFromElement(img) {
    if (!img || img.nodeType !== Node.ELEMENT_NODE) return { width: 0, height: 0 };
    var rect = { width: 0, height: 0 };
    try { rect = img.getBoundingClientRect(); } catch (_) {}
    return {
      width: Math.max(img.naturalWidth || 0, Math.round(rect.width || 0)),
      height: Math.max(img.naturalHeight || 0, Math.round(rect.height || 0)),
    };
  }

  
  
  function isMeaningfulImageElement(img, role) {
    if (!img || img.nodeType !== Node.ELEMENT_NODE) return false;
    if (img.getAttribute('aria-hidden') === 'true' || img.hidden) return false;

    var tag = (img.tagName || '').toLowerCase();
    var isImg = tag === 'img';
    var isCanvas = tag === 'canvas';
    var isVideo = tag === 'video';
    var isSvgImage = tag === 'image';
    var hasBgImage = false;
    try {
      var bg = window.getComputedStyle(img).backgroundImage;
      hasBgImage = bg && bg.indexOf('url(') !== -1;
    } catch (_) {}

    if (!isImg && !isCanvas && !isVideo && !isSvgImage && !hasBgImage) return false;

    var src = isImg ? String(img.currentSrc || img.src || '') : '';
    var alt = isImg ? String(img.alt || '') : '';
    var inAttachmentShell = !!(img.closest && img.closest(
      '.image-attachment, .file-attachment, [data-test-id="uploaded-file-chip"], file-upload-chip, uploaded-file, .gemini-user-attachment-card'
    ));
    var isGeminiGenerated = isImg && (
      alt.toLowerCase().indexOf('ai generated') !== -1 ||
      src.indexOf('lh3.googleusercontent.com/gg-dl/') !== -1 ||
      src.indexOf('lh3.googleusercontent.com/gg/') !== -1
    );

    if (img.closest && img.closest(
      'button, [role="button"], mat-icon, .avatar, [data-test-id="avatar"], [class*="avatar"]'
    )) {
      if (!isGeminiGenerated && !inAttachmentShell) return false;
    }

    var dims = getImageDimensionsFromElement(img);
    var maxSide = Math.max(dims.width, dims.height);
    var isUploadLikeSrc = isImg && (src.startsWith('blob:') || src.startsWith('data:'));

    if (!isGeminiGenerated && !isPhysicallyVisible(img)) return false;

    if (role === 'user') {
      return inAttachmentShell || isUploadLikeSrc || maxSide >= 96;
    }

    if (role === 'model') {
      return isGeminiGenerated || inAttachmentShell || maxSide >= 128;
    }

    return inAttachmentShell || isUploadLikeSrc || maxSide >= 96;
  }


  
  function getMeaningfulImages(turnEl, role) {
    if (!turnEl || turnEl.nodeType !== Node.ELEMENT_NODE) return [];

    var allImages = [];
    for (var i = 0; i < SELECTORS.inlineImage.length; i++) {
      try {
        allImages = allImages.concat(deepQueryAll(SELECTORS.inlineImage[i], turnEl));
      } catch (_) {}
    }

    try { allImages = allImages.concat(deepQueryAll('img', turnEl)); } catch (_) {}
    try { allImages = allImages.concat(deepQueryAll('image', turnEl)); } catch (_) {}
    try { allImages = allImages.concat(deepQueryAll('canvas', turnEl)); } catch (_) {}
    try { allImages = allImages.concat(deepQueryAll('video', turnEl)); } catch (_) {}
    try { allImages = allImages.concat(deepQueryAll('[style*="background-image"]', turnEl)); } catch (_) {}

    return uniqueElements(allImages).filter(function(img) {
      return isMeaningfulImageElement(img, role);
    });
  }


  function countImages(turnEl, role) {
    return getMeaningfulImages(turnEl, role).length;
  }

  function getImageTokenTotal(turnEl, role, images) {
    images = images || getMeaningfulImages(turnEl, role);
    var total = 0;

    for (var i = 0; i < images.length; i++) {
      var dims = getImageDimensionsFromElement(images[i]);
      total += role === 'model'
        ? Tokenizer.estimateGeneratedImageTokens(dims.width, dims.height, getActiveImageEstimatorContext())
        : Tokenizer.estimateImageInputTokens(dims.width, dims.height, getActiveImageEstimatorContext());
    }

    return total;
  }

  function debugModelImageCount(turnEl, images, index) {
    if (!turnEl || !images) return;
    if (!images.length) return;

    var samples = images.slice(0, 3).map(function(el) {
      var dims = getImageDimensionsFromElement(el);
      var tag = (el.tagName || 'node').toLowerCase();
      var src = '';
      if (tag === 'img') {
        src = String(el.currentSrc || el.src || '');
      } else {
        try {
          var bg = window.getComputedStyle(el).backgroundImage;
          if (bg && bg.indexOf('url(') !== -1) src = bg;
        } catch (_) {}
      }
      if (src.length > 80) src = src.slice(0, 77) + '...';
      return tag + ' ' + dims.width + 'x' + dims.height + (src ? ' ' + src : '');
    });

    var signature = images.length + '|' + samples.join(';');
    if (modelImageDebug.get(turnEl) === signature) return;
    modelImageDebug.set(turnEl, signature);

    if (isDebugEnabled()) console.log('[TokenMeter] Model images detected (turn ' + index + '):', {
      count: images.length,
      samples: samples,
    });
  }

  function traceGeneratedImagesOnce() {
    var searchArea = getChatLogContainer() || document;
    var allImages = [];
    for (var i = 0; i < SELECTORS.inlineImage.length; i++) {
      try {
        allImages = allImages.concat(deepQueryAll(SELECTORS.inlineImage[i], searchArea));
      } catch (_) {}
    }

    try { allImages = allImages.concat(deepQueryAll('img', searchArea)); } catch (_) {}
    try { allImages = allImages.concat(deepQueryAll('image', searchArea)); } catch (_) {}
    try { allImages = allImages.concat(deepQueryAll('canvas', searchArea)); } catch (_) {}
    try { allImages = allImages.concat(deepQueryAll('video', searchArea)); } catch (_) {}
    try { allImages = allImages.concat(deepQueryAll('[style*="background-image"]', searchArea)); } catch (_) {}

    var uniqueList = uniqueElements(allImages);
    var generated = [];
    for (var j = 0; j < uniqueList.length; j++) {
      var el = uniqueList[j];
      var tag = (el.tagName || '').toLowerCase();
      var src = tag === 'img' ? String(el.currentSrc || el.src || '') : '';
      var alt = tag === 'img' ? String(el.alt || '') : '';
      var isGenerated = (alt.toLowerCase().indexOf('ai generated') !== -1) ||
                        src.indexOf('lh3.googleusercontent.com/gg-dl/') !== -1;
      if (isGenerated) generated.push(el);
    }

    var summary = {
      ts: Date.now(),
      url: String(location.href || ''),
      chatId: getChatIdFromUrl() || currentChatId || '',
      totalCandidates: uniqueList.length,
      generatedCandidates: generated.length,
      modelTurnMatches: 0,
      userTurnMatches: 0,
      unassigned: 0,
      samples: [],
    };

    for (var k = 0; k < generated.length; k++) {
      var img = generated[k];
      var inModel = isInsideSelectorGroup(img, SELECTORS.modelTurn);
      var inUser = isInsideSelectorGroup(img, SELECTORS.userTurn);
      if (inModel) summary.modelTurnMatches++;
      else if (inUser) summary.userTurnMatches++;
      else summary.unassigned++;

      if (summary.samples.length < 6) {
        var dims = getImageDimensionsFromElement(img);
        var tag2 = (img.tagName || '').toLowerCase();
        var src2 = tag2 === 'img' ? String(img.currentSrc || img.src || '') : '';
        var alt2 = tag2 === 'img' ? String(img.alt || '') : '';
        if (src2.length > 120) src2 = src2.slice(0, 117) + '...';
        if (alt2.length > 80) alt2 = alt2.slice(0, 77) + '...';
        summary.samples.push({
          tag: tag2,
          src: src2,
          alt: alt2,
          dims: dims,
          visible: isPhysicallyVisible(img),
          inModelTurn: inModel,
          inUserTurn: inUser,
          meaningfulAsModel: isMeaningfulImageElement(img, 'model'),
          meaningfulAsUser: isMeaningfulImageElement(img, 'user'),
        });
      }
    }

    return summary;
  }

  function checkImageTraceRequest() {
    var key = 'gtm_trace_images';
    var outKey = 'gtm_trace_images_result';
    var raw = '';
    try { raw = localStorage.getItem(key); } catch (_) { return; }
    if (!raw) return;
    if (raw !== '1' && raw !== 'true' && raw !== 'now') return;

    try {
      var result = traceGeneratedImagesOnce();
      try { localStorage.setItem(outKey, JSON.stringify(result)); } catch (_) {}
    } catch (err) {
      try { localStorage.setItem(outKey, JSON.stringify({ error: String(err) })); } catch (_) {}
    }

    try { localStorage.removeItem(key); } catch (_) {}
  }

  function isPhysicallyVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;

    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    try {
      var cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') {
        return false;
      }
    } catch (_) {}

    return true;
  }

  function isSystemAttachmentChrome(el) {
    return !!(el && el.closest && el.closest(SYSTEM_ATTACHMENT_ANCESTOR_SELECTORS));
  }

  function getAttachmentChipText(chip) {
    var nameEl = null;
    try {
      nameEl = chip.querySelector('.file-name-text, [data-name], .upload-file-name, [data-file-name]');
    } catch (_) {}

    var preferred = '';
    try {
      preferred = cleanText(
        (nameEl && (nameEl.getAttribute('data-name') || nameEl.innerText || nameEl.textContent)) || ''
      );
    } catch (_) {}

    if (preferred) return preferred;
    return cleanText(chip.innerText || chip.textContent || '');
  }

  function looksLikeFileDescriptor(text) {
    if (!text) return false;
    if (/\.[a-z0-9]{2,8}\b/i.test(text)) return true;
    if (/[\d.]+\s*(KB|MB|GB)\b/i.test(text)) return true;
    if (/\b\d+\s*page(?:s)?\b/i.test(text)) return true;
    if (/\b(pdf|docx?|xlsx?|csv|txt|json|pptx?|zip|png|jpe?g|webp|gif)\b/i.test(text)) return true;
    return false;
  }

  function hasConfirmedUploadMarker(chip) {
    if (!chip || chip.nodeType !== Node.ELEMENT_NODE) return false;

    try {
      if (chip.matches('[data-test-id="uploaded-file-chip"], file-upload-chip, uploaded-file')) {
        return true;
      }
    } catch (_) {}

    var hasRemoveFileControl = false;
    try {
      if (chip.matches('[aria-label^="Remove file "], [aria-label*="Remove file"]')) {
        hasRemoveFileControl = true;
      }
    } catch (_) {}
    try {
      if (chip.querySelector('[aria-label^="Remove file "], [aria-label*="Remove file"]')) {
        hasRemoveFileControl = true;
      }
    } catch (_) {}

    var hasFileNameMarker = false;
    try {
      if (chip.matches('[data-file-name], [data-name], .file-name-text, .upload-file-name')) {
        hasFileNameMarker = true;
      }
    } catch (_) {}
    try {
      if (chip.querySelector('.file-name-text, [data-name], .upload-file-name, [data-file-name]')) {
        hasFileNameMarker = true;
      }
    } catch (_) {}

    if (!hasRemoveFileControl && !hasFileNameMarker) return false;

    var chipText = getAttachmentChipText(chip);
    if (!looksLikeFileDescriptor(chipText)) return false;

    return true;
  }

  function shouldUseDomAttachmentFallback() {
    return !!(totalFileTokens > 0 || networkFallbackTokens > 0 || hasConfirmedUploadChipAnywhere());
  }

  function isConfirmedUploadChip(chip, userMessageElement) {
    if (!chip || chip.nodeType !== Node.ELEMENT_NODE) return false;
    if (userMessageElement && !userMessageElement.contains(chip)) return false;
    if (chip.getAttribute('aria-hidden') === 'true' || chip.hidden) return false;
    if (!isPhysicallyVisible(chip)) return false;
    if (isSystemAttachmentChrome(chip)) return false;

    if (chip.closest && chip.closest('[data-message-author-role="model"], model-response')) {
      return false;
    }
    if (chip.closest && chip.closest(
      'code-immersive-panel, immersive-panel, deep-research-immersive-panel, [data-test-id*="canvas"], [class*="canvas"], .ProseMirror, browse-chip-list, browse-file-chip'
    )) {
      return false;
    }

    return hasConfirmedUploadMarker(chip);
  }

  function hasConfirmedUploadChipAnywhere() {
    var allChips = [];
    for (var i = 0; i < ATTACHMENT_CANDIDATE_SELECTORS.length; i++) {
      try {
        allChips = allChips.concat(deepQueryAll(ATTACHMENT_CANDIDATE_SELECTORS[i], document));
      } catch (_) {}
    }

    return uniqueElements(allChips).some(function(chip) {
      return isConfirmedUploadChip(chip);
    });
  }

  function getRealAttachmentChips(userMessageElement) {
    if (!userMessageElement || userMessageElement.nodeType !== Node.ELEMENT_NODE) {
      return [];
    }

    var allChips = [];
    for (var i = 0; i < ATTACHMENT_CANDIDATE_SELECTORS.length; i++) {
      try {
        allChips = allChips.concat(deepQueryAll(ATTACHMENT_CANDIDATE_SELECTORS[i], userMessageElement));
      } catch (_) {}
    }

    return uniqueElements(allChips).filter(function(chip) {
      return isConfirmedUploadChip(chip, userMessageElement);
    });
  }

  function getRealAttachments(userMessageElement) {
    return getRealAttachmentChips(userMessageElement).length;
  }

  function getChatLogContainer() {
    var containerSelectors = [
      'chat-window',
      'message-list',
      '.conversation-container',
      'conversation-container',
      '[data-test-id="conversation-view"]',
    ];

    for (var i = 0; i < containerSelectors.length; i++) {
      try {
        var container = deepQuery(containerSelectors[i], document);
        if (container) return container;
      } catch (_) {}
    }

    // Fallback: if real turns already exist, bind to their nearest shared wrapper
    // instead of scanning the whole document.
    var turnSelectors = SELECTORS.userTurn.concat(SELECTORS.modelTurn);
    var firstTurn = queryAll(turnSelectors, document).filter(isMeaningfulTurn)[0] || null;

    if (!firstTurn) return null;

    return firstTurn.parentElement || null;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ DOM chip fallback (when file interceptor has no data) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  function attachmentChipFallback(turnEl) {
    if (!shouldUseDomAttachmentFallback()) {
      return 0;
    }

    var docTokens = 0;
    var realChips = getRealAttachmentChips(turnEl);

    // Zero real attachments means the bubble only contains framework noise.
    if (getRealAttachments(turnEl) === 0) {
      return 0;
    }

    for (var j = 0; j < realChips.length; j++) {
      var chipText = cleanText(realChips[j].innerText || realChips[j].textContent || '');
      if (!looksLikeFileDescriptor(chipText)) {
        continue;
      }
      if (chipText.length > 80) { docTokens += Math.ceil(chipText.split(/\s+/).filter(Boolean).length * 1.33); continue; }
      var sm = chipText.match(/([\d.]+)\s*(KB|MB|GB)/i);
      if (sm) {
        var val = parseFloat(sm[1]);
        var kb  = sm[2].toUpperCase() === 'GB' ? val*1e6 : sm[2].toUpperCase() === 'MB' ? val*1e3 : val;
        // Use 225 tokens/KB as rough plain-text equivalent (not raw file bytes)
        docTokens += Math.ceil(kb * 225);
        continue;
      }
      var pm = chipText.match(/(\d+)\s*page/i);
      if (pm) { docTokens += parseInt(pm[1], 10) * 560; continue; }
      docTokens += 840;  // ~1.5 page hard fallback
    }
    return docTokens;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ SSR ghost filter Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //
  // On a hard reload of /app, Gemini injects SSR placeholder <user-query> nodes
  // inside the input area or as zero-dimension invisible shells. These are NOT
  // real chat history Ã¢â‚¬â€ they are server-side scaffolding that React/Angular tears
  // down on SPA navigation. Without this filter, the extension counts them as
  // live turns, producing phantom token spikes (~175 tokens) on fresh load.
  //
  // Three rejection rules (any one is enough to discard the element):
  //   1. Lives inside the input bar or footer chrome  Ã¢â€ â€™ structural ghost
  //   2. aria-hidden="true"                           Ã¢â€ â€™ explicitly invisible
  //   3. getBoundingClientRect() Ã¢â€ â€™ 0Ãƒâ€”0               Ã¢â€ â€™ unrendered SSR shell

  function isValidTurn(el) {
    if (!el) return false;

    // 1. Ignore anything inside the input form or bottom footer
    if (el.closest && el.closest(
      'input-area-v2, text-input-v2, .input-area, form, .input-footer, [data-test-id="bottom-bar"]'
    )) return false;

    // 2. Reject explicitly hidden system tokens
    if (el.getAttribute('aria-hidden') === 'true') return false;

    // 3. Reject unrendered SSR placeholders (zero dimensions)
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      try {
        var cs = window.getComputedStyle(el);
        if (cs.display === 'contents') return true;
      } catch (_) {}

      try {
        if (el.querySelector &&
            el.querySelector('img[alt*="AI generated"], img[src*="lh3.googleusercontent.com/gg-dl/"]')) {
          return true;
        }
      } catch (_) {}

      return false;
    }

    return true;
  }

  function hasStructuredTurnText(turnEl) {
    for (var i = 0; i < SELECTORS.turnText.length; i++) {
      var matches = [];
      try { matches = deepQueryAll(SELECTORS.turnText[i], turnEl); } catch (_) {}
      for (var j = 0; j < matches.length; j++) {
        if (!isPhysicallyVisible(matches[j])) continue;
        var text = cleanText(matches[j].innerText || matches[j].textContent || '');
        if (text) return true;
      }
    }
    return false;
  }
  function getTurnRoleHint(el) {
    if (!el || !el.matches) return '';
    for (var i = 0; i < SELECTORS.modelTurn.length; i++) {
      try { if (el.matches(SELECTORS.modelTurn[i])) return 'model'; } catch (_) {}
    }
    for (var j = 0; j < SELECTORS.userTurn.length; j++) {
      try { if (el.matches(SELECTORS.userTurn[j])) return 'user'; } catch (_) {}
    }
    return '';
  }

  function isInsideSelectorGroup(el, selectors) {
    if (!el || !el.closest) return false;
    for (var i = 0; i < selectors.length; i++) {
      try { if (el.closest(selectors[i])) return true; } catch (_) {}
    }
    return false;
  }

  function isMeaningfulTurn(el) {
    if (!isValidTurn(el)) return false;
    if (hasStructuredTurnText(el)) return true;
    var roleHint = getTurnRoleHint(el);
    if (countImages(el, roleHint) > 0) return true;
    if (getRealAttachments(el) > 0) return true;
    return false;
  }
  function isZeroStateEmptyPage() {
    if (!getChatIdFromUrl()) {
      return true;
    }

    var chatLogContainer = getChatLogContainer();
    if (!chatLogContainer) return true;

    var turnSelectors = SELECTORS.userTurn.concat(SELECTORS.modelTurn);
    var hasRealMessages = queryAll(turnSelectors, chatLogContainer).some(isMeaningfulTurn);
    return !hasRealMessages;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Conversation scrape Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  
  
  function scrapeConversation() {
    // Blind the scraper to SSR suggestions, hidden inputs, and homepage chrome
    // until an actual conversation exists in the DOM.
    if (isZeroStateEmptyPage()) {
      return [];
    }

    var searchArea = getChatLogContainer();
    if (!searchArea) {
      return [];
    }

    // Only scrape inside the real chat history container, never across the full page.
    var userTurns  = queryAll(SELECTORS.userTurn, searchArea).filter(isMeaningfulTurn);
    var modelTurns = queryAll(SELECTORS.modelTurn, searchArea).filter(isMeaningfulTurn);
    var allTurns   = [];
    for (var i = 0; i < userTurns.length;  i++) allTurns.push({ el: userTurns[i],  role: 'user'  });
    for (var i = 0; i < modelTurns.length; i++) allTurns.push({ el: modelTurns[i], role: 'model' });
    allTurns.sort(function(a, b) {
      var pos = a.el.compareDocumentPosition(b.el);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    var messages = [];
    var accountedImages = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    for (var i = 0; i < allTurns.length; i++) {
      var el   = allTurns[i].el;
      var role = allTurns[i].role;
      var imagesList = getMeaningfulImages(el, role);
      if (role === 'model') {
        debugModelImageCount(el, imagesList, i + 1);
        if (accountedImages) {
          for (var im = 0; im < imagesList.length; im++) {
            accountedImages.add(imagesList[im]);
          }
        }
      }
      messages.push({
        role:           role,
        text:           extractTurnText(el),
        thinkingTokens: extractThinkingTokens(el),
        images:         imagesList.length,
        imageTokens:    role === 'model' ? getImageTokenTotal(el, role, imagesList) : 0,
        userImageTokens: role === 'user' ? getImageTokenTotal(el, role, imagesList) : 0,
        docTokens:      role === 'user' ? attachmentChipFallback(el) : 0,
        docPages:       0,
      });
    }

    // Fallback: catch generated images that live outside detected model turns.
    var orphanImages = getMeaningfulImages(searchArea, 'model').filter(function(img) {
      if (accountedImages && accountedImages.has(img)) return false;
      if (isInsideSelectorGroup(img, SELECTORS.userTurn)) return false;
      return true;
    });
    if (orphanImages.length) {
      var orphanTokens = getImageTokenTotal(searchArea, 'model', orphanImages);
      var attached = false;
      for (var m = messages.length - 1; m >= 0; m--) {
        if (messages[m].role === 'model') {
          messages[m].images = (messages[m].images || 0) + orphanImages.length;
          messages[m].imageTokens = (messages[m].imageTokens || 0) + orphanTokens;
          attached = true;
          break;
        }
      }
      if (!attached) {
        messages.push({
          role: 'model',
          text: '',
          thinkingTokens: 0,
          images: orphanImages.length,
          imageTokens: orphanTokens,
          userImageTokens: 0,
          docTokens: 0,
          docPages: 0,
        });
      }
    }
    return messages;
  }



  function sumThinkingTokens(msgs) {
    return msgs.filter(function(m){return m.role==='model';})
               .reduce(function(a,m){return a+(m.thinkingTokens||0);},0);
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Safe storage wrapper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  function safeStorageGet(keys) {
    return new Promise(function(resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime) return resolve({});
        if (!chrome.runtime.id) return resolve({});
        chrome.storage.local.get(keys, function(result) {
          if (chrome.runtime.lastError) return resolve({});
          resolve(result || {});
        });
      } catch (_) { resolve({}); }
    });
  }

  function ensurePanel() {
    if (!document.getElementById('gtm-panel')) {
      TokenMeterUI.inject();
      initThemeSync();
    }
    observePanelDockChanges();
    scheduleDockCheck();
  }


  var dockCheckFrame = 0;
  var dockTrackUntil = 0;
  var dockResizeObserver = null;
  var PANEL_ANCHOR_SELECTOR = '[data-test-id="bard-text"]';
  var PANEL_TITLE_SELECTOR = '[data-test-id="conversation-title"]';
  var PANEL_TITLE_BOUNDARY_SELECTOR = '.conversation-title-column';
  var PANEL_HEADER_HOST_SELECTORS = [
    '[data-test-id="app-bar"]',
    'header',
    '[role="banner"]',
    '.top-bar',
    '.app-bar',
  ].join(', ');
  var PANEL_DOCK_MARGIN_X = 16;
  var PANEL_DOCK_MARGIN_Y = 8;
  var PANEL_DOCK_GAP_X = 14;
  var PANEL_DOCK_OFFSET_Y = -18;
  var PANEL_DOCK_HEADER_CLEARANCE_Y = 10;
  var PANEL_DOCK_TRACK_MS = 320;
  var PANEL_COLLAPSED_DEFAULT_WIDTH = 196;
  var PANEL_COLLAPSED_LINEAR_BASE_WIDTH = 198;
  var PANEL_COLLAPSED_COLLISION_GAP = 12;
  var PANEL_COLLAPSED_BOUNDARY_BUFFER = 30;
  var PANEL_COLLAPSED_COMPACT_REDUCTION_RATIO = 0.4;
  var PANEL_COLLAPSED_COMPACT_SIZE = 56;
  var PANEL_COLLAPSED_COMPACT_TRANSITION_MS = 220;

  function pickBestVisibleRect(candidates, requiredText, referenceTop) {
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    var bestRect = null;
    var bestDistance = Infinity;

    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!el) continue;
      if (requiredText && cleanText(el.textContent || '') !== requiredText) continue;

      var rect = el.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) continue;
      if (rect.bottom <= 0 || rect.right <= 0) continue;
      if (viewportWidth && rect.left >= viewportWidth) continue;
      if (viewportHeight && rect.top >= viewportHeight) continue;

      if (isFinite(referenceTop)) {
        var distance = Math.abs(rect.top - referenceTop);
        if (!bestRect || distance < bestDistance ||
            (distance === bestDistance && rect.left < bestRect.left)) {
          bestRect = rect;
          bestDistance = distance;
        }
        continue;
      }

      if (!bestRect ||
          rect.top < bestRect.top ||
          (rect.top === bestRect.top && rect.left < bestRect.left)) {
        bestRect = rect;
      }
    }

    return bestRect;
  }

  function pickBestVisibleElement(candidates, requiredText, referenceTop) {
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    var bestEl = null;
    var bestRect = null;
    var bestDistance = Infinity;

    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!el) continue;
      if (requiredText && cleanText(el.textContent || '') !== requiredText) continue;

      var rect = el.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) continue;
      if (rect.bottom <= 0 || rect.right <= 0) continue;
      if (viewportWidth && rect.left >= viewportWidth) continue;
      if (viewportHeight && rect.top >= viewportHeight) continue;

      if (isFinite(referenceTop)) {
        var distance = Math.abs(rect.top - referenceTop);
        if (!bestEl || distance < bestDistance ||
            (distance === bestDistance && rect.left < bestRect.left)) {
          bestEl = el;
          bestRect = rect;
          bestDistance = distance;
        }
        continue;
      }

      if (!bestEl ||
          rect.top < bestRect.top ||
          (rect.top === bestRect.top && rect.left < bestRect.left)) {
        bestEl = el;
        bestRect = rect;
      }
    }

    return bestEl;
  }

  function getPanelAnchorRect() {
    var candidates = deepQueryAll(PANEL_ANCHOR_SELECTOR, document);
    if (!candidates.length) candidates = deepQueryAll('.bard-text', document);
    return pickBestVisibleRect(candidates, 'Gemini');
  }

  function getPanelAnchorElement() {
    var candidates = deepQueryAll(PANEL_ANCHOR_SELECTOR, document);
    if (!candidates.length) candidates = deepQueryAll('.bard-text', document);
    return pickBestVisibleElement(candidates, 'Gemini');
  }

  function getPanelHeaderHostRect(anchorEl, anchorRect) {
    if (anchorEl && typeof anchorEl.closest === 'function') {
      var host = anchorEl.closest(PANEL_HEADER_HOST_SELECTORS);
      if (host) {
        var hostRect = host.getBoundingClientRect();
        if (hostRect.width > 0 && hostRect.height > 0) return hostRect;
      }
    }

    // Fallback: walk up a few ancestors and prefer wide flex-like containers.
    var depth = 0;
    var node = anchorEl;
    while (node && node.parentElement && depth < 7) {
      node = node.parentElement;
      depth += 1;
      var rect = node.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) continue;
      var styles = window.getComputedStyle(node);
      var isFlex = styles && (styles.display === 'flex' || styles.display === 'inline-flex');
      if (!isFlex) continue;
      if (anchorRect && rect.top > (anchorRect.top + 20)) continue;
      if (rect.width < 200) continue;
      return rect;
    }

    return null;
  }

  function getConversationTitleRect(anchorRect) {
    var referenceTop = anchorRect && isFinite(anchorRect.top) ? anchorRect.top : NaN;
    return pickBestVisibleRect(deepQueryAll(PANEL_TITLE_SELECTOR, document), '', referenceTop);
  }

  function getConversationTitleBoundaryRect(anchorRect) {
    var referenceTop = anchorRect && isFinite(anchorRect.top) ? anchorRect.top : NaN;
    var boundaryRect = pickBestVisibleRect(deepQueryAll(PANEL_TITLE_BOUNDARY_SELECTOR, document), '', referenceTop);
    if (boundaryRect) return boundaryRect;

    var titleCandidates = deepQueryAll(PANEL_TITLE_SELECTOR, document);
    var boundaryCandidates = [];
    for (var i = 0; i < titleCandidates.length; i++) {
      var titleEl = titleCandidates[i];
      if (!titleEl || typeof titleEl.closest !== 'function') continue;
      var boundaryEl = titleEl.closest(PANEL_TITLE_BOUNDARY_SELECTOR);
      if (boundaryEl && boundaryCandidates.indexOf(boundaryEl) === -1) {
        boundaryCandidates.push(boundaryEl);
      }
    }

    if (boundaryCandidates.length) {
      boundaryRect = pickBestVisibleRect(boundaryCandidates, '', referenceTop);
      if (boundaryRect) return boundaryRect;
    }

    return pickBestVisibleRect(titleCandidates, '', referenceTop);
  }

  function getPanelVerticalReferenceTop(anchorRect) {
    var titleRect = getConversationTitleRect(anchorRect);
    if (titleRect && anchorRect) return Math.min(titleRect.top, anchorRect.top);
    if (titleRect) return titleRect.top;
    if (anchorRect) return anchorRect.top;
    return NaN;
  }

  function syncCollapsedPanelLayout(panel, nextLeft, nextTop, anchorRect) {
    var isCollapsedState = panel.classList.contains('gtm-collapsed') || panel.classList.contains('gtm-collapsing');
    var titleBoundaryRect = isCollapsedState ? getConversationTitleBoundaryRect(anchorRect) : null;
    var compactThreshold = PANEL_COLLAPSED_LINEAR_BASE_WIDTH * (1 - PANEL_COLLAPSED_COMPACT_REDUCTION_RATIO);
    var currentCompact = panel.classList.contains('gtm-collapsed-compact');
    var currentEntering = panel.classList.contains('gtm-collapsed-compact-entering');
    var nextCollapsedWidth = PANEL_COLLAPSED_DEFAULT_WIDTH;
    var nextCompact = false;
    var nextEntering = false;

    if (titleBoundaryRect) {
      var collapsedHeight = Number(panel.dataset.collapsedHeight) || panel.offsetHeight || 0;
      var overlapsVertically = titleBoundaryRect.bottom > nextTop && titleBoundaryRect.top < (nextTop + collapsedHeight);
      var overlapsHorizontally = titleBoundaryRect.left < (nextLeft + PANEL_COLLAPSED_DEFAULT_WIDTH) && titleBoundaryRect.right > nextLeft;

      if (overlapsVertically && overlapsHorizontally) {
        var availableWidth = titleBoundaryRect.left - nextLeft - PANEL_COLLAPSED_COLLISION_GAP - PANEL_COLLAPSED_BOUNDARY_BUFFER;
        var boundedWidth = Math.min(PANEL_COLLAPSED_DEFAULT_WIDTH, Math.floor(availableWidth));
        if (!isFinite(boundedWidth)) boundedWidth = PANEL_COLLAPSED_DEFAULT_WIDTH;
        nextCollapsedWidth = Math.max(40, boundedWidth);

        if (!isFinite(availableWidth) || availableWidth <= 0 || availableWidth <= compactThreshold) {
          if (currentCompact) {
            nextCompact = true;
            nextCollapsedWidth = PANEL_COLLAPSED_COMPACT_SIZE;
          } else {
            nextEntering = true;
            nextCollapsedWidth = Math.max(Math.ceil(compactThreshold), nextCollapsedWidth);
          }
        }
      }
    }

    if (!isCollapsedState || (!nextCompact && !nextEntering)) {
      if (panel._gtmCompactEnterTimer) {
        clearTimeout(panel._gtmCompactEnterTimer);
        panel._gtmCompactEnterTimer = 0;
      }
    }

    if (!isCollapsedState) {
      nextCollapsedWidth = PANEL_COLLAPSED_DEFAULT_WIDTH;
      nextCompact = false;
      nextEntering = false;
    }

    if (nextEntering && !panel._gtmCompactEnterTimer) {
      panel._gtmCompactEnterTimer = window.setTimeout(function() {
        var livePanel = document.getElementById('gtm-panel');
        if (!livePanel) return;
        livePanel._gtmCompactEnterTimer = 0;
        if (!(livePanel.classList.contains('gtm-collapsed') || livePanel.classList.contains('gtm-collapsing'))) {
          livePanel.classList.remove('gtm-collapsed-compact-entering');
          livePanel.classList.remove('gtm-collapsed-compact');
          return;
        }
        livePanel.classList.remove('gtm-collapsed-compact-entering');
        livePanel.classList.add('gtm-collapsed-compact');
        livePanel.style.setProperty('--gtm-collapsed-width', PANEL_COLLAPSED_COMPACT_SIZE + 'px');
        livePanel.dispatchEvent(new CustomEvent('gtm:sync-collapsed-layout'));
        scheduleDockCheck();
      }, PANEL_COLLAPSED_COMPACT_TRANSITION_MS);
    }

    var nextWidthValue = nextCollapsedWidth + 'px';
    var widthChanged = panel.style.getPropertyValue('--gtm-collapsed-width') !== nextWidthValue;
    var compactChanged = currentCompact !== nextCompact;
    var enteringChanged = currentEntering !== nextEntering;

    panel.style.setProperty('--gtm-collapsed-width', nextWidthValue);
    panel.classList.toggle('gtm-collapsed-compact', nextCompact);
    panel.classList.toggle('gtm-collapsed-compact-entering', nextEntering);

    if (isCollapsedState && (widthChanged || compactChanged || enteringChanged)) {
      panel.dispatchEvent(new CustomEvent('gtm:sync-collapsed-layout'));
    }
  }

  function observePanelDockChanges() {
    // Floating-dot UX: panel is independently positioned via ui.js drag logic.
    // Keep this as a no-op so legacy calls remain safe.
    return;
  }

  function clampPanelPosition(value, min, max) {
    if (!isFinite(value)) return min;
    if (!isFinite(max) || max < min) return min;
    return Math.max(min, Math.min(value, max));
  }

  function updatePanelDock() {
    // Floating-dot UX: panel placement is managed in ui.js.
    return;
  }

  function runDockCheckLoop() {
    dockCheckFrame = 0;
  }

  function scheduleDockCheck() {
    return;
  }

  async function recalculate() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && !chrome.runtime.id) {
        clearInterval(syncInterval); return;
      }
    } catch (_) { clearInterval(syncInterval); return; }

    ensurePanel();
    checkImageTraceRequest();
    refreshTrackedImageTokenEstimates();

    var zeroState = isZeroStateEmptyPage();
    var messages  = zeroState ? [] : scrapeConversation();
    // Respect send-freeze: return 0 while the input is clearing after send
    var draftEl   = queryFirst(SELECTORS.draftInput);
    var draftText = (!draftFrozen && draftEl)
      ? cleanText(draftEl.innerText || draftEl.value || '')
      : '';

    var stored  = await safeStorageGet(['gtm_use_api', 'gtm_api_key']);
    var apiMode = !!(stored.gtm_use_api && stored.gtm_api_key);

    var counts = await getConversationCounts(messages, apiMode);

    var userTurnCount = messages.reduce(function(acc, msg) {
      return acc + (msg.role === 'user' ? 1 : 0);
    }, 0);

    if (totalFileTokens > 0) {
      pendingDraftAttachmentTokens = totalFileTokens;
      pendingDraftAttachmentSignature = getUploadSignature();
    }

    if (pendingDraftAttachmentTokens > 0 &&
        totalFileTokens === 0 &&
        userTurnCount > lastUserTurnCount &&
        currentChatId) {
      var sendSignature = pendingDraftAttachmentSignature || String(pendingDraftAttachmentTokens);
      var now = Date.now();

      if (sendSignature &&
          (sendSignature !== lastSentAttachmentSignature ||
           (now - lastSentAttachmentAt) >= SENT_ATTACHMENT_DEDUP_MS)) {
        ensureHistoryAttachmentLoaded(function() {
          var nextTotal = (storedHistoryAttachmentTokens || 0) + pendingDraftAttachmentTokens;
          storedHistoryAttachmentTokens = nextTotal;
          historyAttachmentLoaded = true;
          lastSentAttachmentSignature = sendSignature;
          lastSentAttachmentAt = now;
          saveHistoryAttachmentTokens(nextTotal);
        });
      }

      pendingDraftAttachmentTokens = 0;
      pendingDraftAttachmentSignature = '';
    }

    // Attachment token priority:
    //   1. local tracked uploads (authoritative before send)
    //   2. network fallback from background.js when no local tracking exists
    //   3. DOM chip label estimation as a last-resort fallback for restored chats
    var docChipTokens        = zeroState ? 0 : messages.reduce(function(a,m){return a+(m.docTokens||0);},0);
    var historyImageTokens   = zeroState ? 0 : messages.reduce(function(a,m){return a+(m.userImageTokens||0);},0);
    var domChipTokens        = docChipTokens + historyImageTokens;
    var hasVisibleConfirmedUploadChip = hasConfirmedUploadChipAnywhere();
    var trackedFileCount     = getTrackedFileCount();
    var localAttachmentTokens = totalFileTokens;
    var networkAttachmentTokens = networkFallbackTokens;
    var attachSource         = 'none';
    var attachTokens         = 0;

    // Legacy migration: if we have stored draft tokens from older sessions
    // but no history bucket yet, promote them once we confirm real user turns.
    if (!zeroState && currentChatId && historyAttachmentLoaded &&
        storedHistoryAttachmentTokens === 0 &&
        trackedFileCount === 0 &&
        localAttachmentTokens > 0 &&
        userTurnCount > 0) {
      storedHistoryAttachmentTokens = localAttachmentTokens;
      saveHistoryAttachmentTokens(localAttachmentTokens);
      debugLogOnce('History tokens migrated from legacy store', currentChatId + ':' + localAttachmentTokens, {
        chatId: currentChatId,
        tokens: localAttachmentTokens,
      });
    }

    if (trackedFileCount > 0) {
      attachTokens = localAttachmentTokens;
      attachSource = 'local-upload-store';
    } else {
      var allowHistoryFallback =
        hasVisibleConfirmedUploadChip ||
        networkAttachmentTokens > 0 ||
        localAttachmentTokens > 0;
      var historyFallbackTokens = Math.max(domChipTokens, storedHistoryAttachmentTokens);
      if (!allowHistoryFallback) {
        if (storedHistoryAttachmentTokens > 0 && currentChatId) {
          storedHistoryAttachmentTokens = 0;
          saveHistoryAttachmentTokens(0);
        }
        historyFallbackTokens = 0;
      }
      if (networkAttachmentTokens > 0 || historyFallbackTokens > 0) {
        attachTokens = Math.max(networkAttachmentTokens, historyFallbackTokens);
        if (attachTokens === networkAttachmentTokens &&
            networkAttachmentTokens >= historyFallbackTokens) {
          attachSource = 'network-fallback';
        } else if (attachTokens === storedHistoryAttachmentTokens &&
                   storedHistoryAttachmentTokens >= domChipTokens) {
          attachSource = 'history-storage';
        } else {
          attachSource = 'dom-chip-fallback';
        }
      }
    }

    if (!zeroState &&
        trackedFileCount === 0 &&
        domChipTokens > 0 &&
        currentChatId &&
        (hasVisibleConfirmedUploadChip || networkAttachmentTokens > 0 || localAttachmentTokens > 0)) {
      if (domChipTokens > storedHistoryAttachmentTokens) {
        storedHistoryAttachmentTokens = domChipTokens;
        saveHistoryAttachmentTokens(domChipTokens);
        if (backfillActive) {
          backfillUntil = Date.now() + BACKFILL_WINDOW_MS;
        }
      }
    }

    if (backfillActive) {
      if (currentChatId !== backfillChatId) {
        stopAttachmentBackfill();
      } else if (Date.now() > backfillUntil) {
        stopAttachmentBackfill();
      } else {
        attachBackfillScrollListener();
      }
    }

    if (!currentChatId && !attachmentInteractionSeen && totalFileTokens === 0) {
      attachTokens = 0;
      attachSource = 'zero-state-gated';
    }
    if (zeroState && !attachmentInteractionSeen && totalFileTokens === 0) {
      attachTokens = 0;
      attachSource = 'zero-state-gated';
    }

    var shouldCountCanvas = !!(currentChatId && !zeroState);
    if (!shouldCountCanvas) {
      canvasTokens = 0;
      canvasLastSignature = '';
      canvasMonacoText = '';
      canvasMonacoLastAt = 0;
      canvasTextSource = 'none-gated';
    }
    var effectiveCanvasTokens = shouldCountCanvas ? canvasTokens : 0;

    debugAttachmentSnapshot();

    // Merge attachments into input and total Ã¢â‚¬â€ this is the core injection fix.
    // attachTokens must be added to input (user sent the file) and therefore
    // also to the global total. Output is never affected by uploads.
    var finalInputTokens = counts.input + attachTokens + effectiveCanvasTokens;
    var finalTotalTokens = finalInputTokens + counts.output;
    var finalOutput      = counts.output;

    lastUserTurnCount = userTurnCount;

    // Server metadata override (Thinking mode exact counts)
    // If background.js parsed usageMetadata from the response stream, use that
    // as a floor Ã¢â‚¬â€ never let DOM estimates go below what the server reported.
    var thinkingTokens;
    if (serverTokenCount && serverTokenCount.total > 0) {
      if (serverTokenCount.prompt > 0) {
        finalInputTokens = Math.max(finalInputTokens, serverTokenCount.prompt);
      }
      finalTotalTokens = Math.max(finalTotalTokens, serverTokenCount.total);
      finalOutput      = Math.max(finalOutput, finalTotalTokens - finalInputTokens);
      thinkingTokens   = serverTokenCount.thoughts;
    } else {
      thinkingTokens   = sumThinkingTokens(messages);
    }

    var adjustedCounts = {
      total:  finalTotalTokens,
      input:  finalInputTokens,
      output: finalOutput,
    };

    var draftTokens    = await getDraftTokenCount(draftText, apiMode);
    var totalWithDraft = adjustedCounts.total + draftTokens;
    var limit          = (Tokenizer && Tokenizer.CONTEXT_LIMIT) ? Tokenizer.CONTEXT_LIMIT : 128000;
    var pct            = limit > 0 ? Math.min(totalWithDraft / limit, 1) : 0;
    var ctxState       = Tokenizer.getContextState(totalWithDraft);

    var trackedUploads = getTrackedUploadDebugList();
    var localImageTokens = trackedUploads
      .filter(function(upload) { return upload.kind === 'image'; })
      .reduce(function(sum, upload) { return sum + (upload.tokens || 0); }, 0);
    var localDocumentTokens = trackedUploads
      .filter(function(upload) { return upload.kind !== 'image'; })
      .reduce(function(sum, upload) { return sum + (upload.tokens || 0); }, 0);

    var warningSignature = [
      trackedFileCount,
      localAttachmentTokens,
      domChipTokens,
      networkAttachmentTokens,
      attachSource,
    ].join('|');
    if (trackedFileCount > 0 &&
        (domChipTokens > localAttachmentTokens || networkAttachmentTokens > localAttachmentTokens) &&
        warningSignature !== lastAttachmentSourceWarning) {
      lastAttachmentSourceWarning = warningSignature;
      if (isDebugEnabled()) console.warn('[TokenMeter] Fallback source exceeded local upload estimate; keeping local store authoritative.', {
        localAttachmentTokens: localAttachmentTokens,
        domChipTokens: domChipTokens,
        networkAttachmentTokens: networkAttachmentTokens,
        trackedUploads: trackedUploads,
      });
    }

    var meterBreakdown = {
      at: Date.now(),
      currentChatId: currentChatId,
      zeroState: zeroState,
      apiMode: apiMode,
      modelMode: currentModelMode,
      modelLabel: currentModelLabel,
      planTier: currentPlanTier,
      planConfidence: currentPlanTierConfidence,
      planSource: currentPlanTierSource,
      historyCount: messages.length,
      trackedFileCount: trackedFileCount,
      trackedUploads: trackedUploads,
      sources: {
        localAttachmentTokens: localAttachmentTokens,
        localImageTokens: localImageTokens,
        localDocumentTokens: localDocumentTokens,
        historyImageTokens: historyImageTokens,
        storedHistoryAttachmentTokens: storedHistoryAttachmentTokens,
        domAttachmentTokens: domChipTokens,
        networkAttachmentTokens: networkAttachmentTokens,
        chosenAttachmentTokens: attachTokens,
        chosenAttachmentSource: attachSource,
        serverPromptTokens: serverTokenCount ? (serverTokenCount.prompt || 0) : 0,
        serverTotalTokens: serverTokenCount ? (serverTokenCount.total || 0) : 0,
      },
      counts: {
        input: counts.input,
        output: counts.output,
        draft: draftTokens,
        canvas: effectiveCanvasTokens,
        finalInput: adjustedCounts.input,
        finalOutput: adjustedCounts.output,
        finalTotal: adjustedCounts.total,
      },
    };
    var estimateIndicator = buildMeterEstimateIndicator(meterBreakdown);
    if (estimateIndicator) {
      meterBreakdown.indicator = estimateIndicator;
    }
    updateMeterBreakdown(meterBreakdown);
    debugChatSnapshot({
      chatId: currentChatId,
      pct: Math.round(pct * 1000) / 10,
      limit: limit,
      totalWithDraft: totalWithDraft,
      ctxState: ctxState.state,
      modelMode: currentModelMode,
      modelLabel: currentModelLabel,
      planTier: currentPlanTier,
      planConfidence: currentPlanTierConfidence,
      planSource: currentPlanTierSource,
      apiMode: apiMode,
      zeroState: zeroState,
      historyCount: messages.length,
      counts: {
        input: counts.input,
        output: counts.output,
        draft: draftTokens,
        canvas: effectiveCanvasTokens,
        finalInput: adjustedCounts.input,
        finalOutput: adjustedCounts.output,
        finalTotal: adjustedCounts.total,
      },
      attachments: {
        trackedFileCount: trackedFileCount,
        totalFileTokens: totalFileTokens,
        localAttachmentTokens: localAttachmentTokens,
        domAttachmentTokens: domChipTokens,
        storedHistoryAttachmentTokens: storedHistoryAttachmentTokens,
        networkAttachmentTokens: networkAttachmentTokens,
        chosenAttachmentTokens: attachTokens,
        chosenAttachmentSource: attachSource,
      },
      canvas: {
        tokens: effectiveCanvasTokens,
        active: shouldCountCanvas && !!canvasRoot,
      },
      server: serverTokenCount ? {
        total: serverTokenCount.total || 0,
        prompt: serverTokenCount.prompt || 0,
        thoughts: serverTokenCount.thoughts || 0,
      } : null,
    });


    TokenMeterUI.update({
      total:            adjustedCounts.total,
      input:            adjustedCounts.input,
      output:           adjustedCounts.output,
      thinkingTokens:   thinkingTokens,
      draftTokens:      draftTokens,
      attachmentTokens: attachTokens,
      canvasTokens:     effectiveCanvasTokens,
      canvasMode:       canvasCountMode,
      historyCount:     Math.min(messages.length, 20),
      limit:            limit,
      pct:              pct,
      state:            ctxState.state,
      apiMode:          apiMode,
      tier:             currentPlanTier,
      tierConfidence:   currentPlanTierConfidence,
      tierSource:       currentPlanTierSource,
      tierAmbiguous:    (currentPlanTier === 'Unknown' || currentPlanTierConfidence === 'low'),
      estimateBadge:    estimateIndicator ? estimateIndicator.badge : '',
      estimateText:     estimateIndicator ? estimateIndicator.text : '',
      estimateTitle:    estimateIndicator ? estimateIndicator.title : '',
    });
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ MutationObserver + init Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  var recalcTimer  = null;
  var syncInterval = null;

  function scheduleRecalc() {
    clearTimeout(recalcTimer);
    recalcTimer = setTimeout(recalculate, 200);
  }

  function ensureCanvasBridgeInjected() {
    if (canvasBridgeInjected) return;
    canvasBridgeInjected = true;
    try {
      if (document.documentElement &&
          document.documentElement.querySelector('script[data-gtm-canvas-bridge]')) {
        debugCanvasSnapshot({ seq: ++canvasDebugSeq, event: 'bridge-exists' });
        return;
      }
    } catch (_) {}
    try {
      var script = document.createElement('script');
      script.setAttribute('data-gtm-canvas-bridge', '1');
      try {
        script.src = chrome.runtime.getURL('canvas-bridge.js');
      } catch (_) {
        debugCanvasSnapshot({ seq: ++canvasDebugSeq, event: 'bridge-src-failed' });
        return;
      }
      script.onload = function() {
        try { script.remove(); } catch (_) {}
        debugCanvasSnapshot({ seq: ++canvasDebugSeq, event: 'bridge-loaded' });
      };
      script.onerror = function() {
        debugCanvasSnapshot({ seq: ++canvasDebugSeq, event: 'bridge-error' });
      };
      (document.documentElement || document.head || document.body).appendChild(script);
      debugCanvasSnapshot({ seq: ++canvasDebugSeq, event: 'bridge-injected' });
    } catch (_) {}
  }

  function requestCanvasMonacoText(root) {
    var host = root || canvasRoot;
    if (!host) return;
    var now = Date.now();
    if (now - canvasLastRequestAt < CANVAS_REQUEST_MIN_MS) return;
    canvasLastRequestAt = now;
    ensureCanvasBridgeInjected();
    try {
      window.postMessage({ type: 'GTM_CANVAS_TEXT_REQUEST' }, '*');
    } catch (_) {}
  }

  window.addEventListener('message', function(ev) {
    try {
      if (ev.source !== window) return;
      var data = ev.data || {};
      if (data.type !== 'GTM_CANVAS_TEXT_RESPONSE') return;
      if (typeof data.text !== 'string') return;
      canvasMonacoText = data.text;
      canvasMonacoLastAt = Date.now();
      debugCanvasSnapshot({
        seq: ++canvasDebugSeq,
        event: 'monaco-response',
        length: canvasMonacoText.length,
      });
      scheduleCanvasScan(canvasRoot, false);
    } catch (_) {}
  });

  function isVisibleCanvasElement(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    var rect = el.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return false;
    if (rect.bottom <= 0 || rect.right <= 0) return false;
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (viewportWidth && rect.left >= viewportWidth) return false;
    if (viewportHeight && rect.top >= viewportHeight) return false;
    try {
      var styles = window.getComputedStyle(el);
      if (styles && (styles.display === 'none' || styles.visibility === 'hidden')) return false;
    } catch (_) {}
    return true;
  }

  function findVisibleCanvasNode(selectors, root) {
    var scope = root || document;
    for (var i = 0; i < selectors.length; i++) {
      try {
        if (scope && scope.nodeType === 1 && scope.matches && scope.matches(selectors[i]) &&
            isVisibleCanvasElement(scope)) {
          return scope;
        }
      } catch (_) {}
      var nodes = [];
      try { nodes = uniqueElements(deepQueryAll(selectors[i], scope)); } catch (_) {}
      for (var j = 0; j < nodes.length; j++) {
        if (isVisibleCanvasElement(nodes[j])) return nodes[j];
      }
    }
    return null;
  }

  function looksLikeCanvasContainer(node) {
    if (!node || node.nodeType !== 1) return false;
    var tagName = '';
    var testId = '';
    var className = '';
    try { tagName = String(node.tagName || '').toLowerCase(); } catch (_) {}
    try { testId = String(node.getAttribute('data-test-id') || '').toLowerCase(); } catch (_) {}
    try { className = String(node.className || '').toLowerCase(); } catch (_) {}

    if (tagName === 'code-immersive-panel' || tagName === 'xap-code-editor') return true;
    if (tagName === 'immersive-panel' || tagName === 'deep-research-immersive-panel') return true;
    if (testId.indexOf('canvas') !== -1 || testId.indexOf('code-editor') !== -1) return true;
    if (className.indexOf('monaco-editor') !== -1) return true;
    if (className.indexOf('immersive') !== -1 && className.indexOf('panel') !== -1) return true;
    if (className.indexOf('canvas') !== -1 && className.indexOf('panel') !== -1) return true;
    return false;
  }

  function findCanvasContainerFromNode(node) {
    var current = node;
    var hops = 0;
    while (current && hops < 20) {
      if (looksLikeCanvasContainer(current) && isVisibleCanvasElement(current)) return current;
      var next = current.parentElement || null;
      if (!next && current.getRootNode) {
        var rootNode = current.getRootNode();
        if (rootNode && rootNode.host) next = rootNode.host;
      }
      current = next;
      hops += 1;
    }
    return node && isVisibleCanvasElement(node) ? node : null;
  }

  function getCanvasRoot() {
    var root = findVisibleCanvasNode(CANVAS_ROOT_SELECTORS, document);
    if (root) {
      var container = null;
      try { container = root.closest(CANVAS_CONTAINER_HINTS); } catch (_) {}
      return container || root;
    }

    var editor = findVisibleCanvasNode(CANVAS_EDITOR_SELECTORS, document);
    if (editor) {
      var fromEditor = findCanvasContainerFromNode(editor);
      if (fromEditor) return fromEditor;
    }

    var monaco = findVisibleCanvasNode(['.monaco-editor'], document);
    if (monaco) {
      var fromMonaco = findCanvasContainerFromNode(monaco);
      if (fromMonaco) return fromMonaco;
    }
    return null;
  }

  function getCanvasEditorText(root) {
    if (!root) return '';

    function isRenderableCanvasElement(el) {
      if (!el || el.nodeType !== 1) return false;
      if (!el.isConnected) return false;
      try {
        var styles = window.getComputedStyle(el);
        if (styles && (styles.display === 'none' || styles.visibility === 'hidden')) return false;
      } catch (_) {}
      return true;
    }

    function getDocNodeText(node) {
      if (!node || !isRenderableCanvasElement(node)) return '';
      try {
        var clone = node.cloneNode(true);
        if (clone && clone.querySelectorAll && CANVAS_DOC_EXCLUDE_SELECTORS) {
          var drop = clone.querySelectorAll(CANVAS_DOC_EXCLUDE_SELECTORS);
          for (var i = 0; i < drop.length; i++) {
            try { drop[i].remove(); } catch (_) {}
          }
        }
        return cleanText(clone.innerText || clone.textContent || '');
      } catch (_) {}
      try {
        return cleanText(node.innerText || node.textContent || '');
      } catch (_) {
        return '';
      }
    }

    function isLikelyCanvasUiNoiseText(text) {
      var normalized = cleanText(text || '');
      if (!normalized) return true;
      if (normalized.length < 24) return true;
      var singleLine = normalized.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!singleLine) return true;
      var noisePhrases = [
        'create',
        'export menu',
        'table of contents menu',
        'close panel',
        'researching uploaded files',
        'researching websites',
      ];
      for (var i = 0; i < noisePhrases.length; i++) {
        if (singleLine === noisePhrases[i]) return true;
      }
      return false;
    }

    function getDocCanvasText(targetRoot) {
      for (var idx = 0; idx < CANVAS_DOC_TEXT_SELECTORS.length; idx++) {
        var bestForSelector = '';
        var nodes = [];
        try { nodes = uniqueElements(deepQueryAll(CANVAS_DOC_TEXT_SELECTORS[idx], targetRoot)); } catch (_) {}
        for (var n = 0; n < nodes.length; n++) {
          var node = nodes[n];
          var raw = getDocNodeText(node);
          if (isLikelyCanvasUiNoiseText(raw)) continue;
          if (raw && raw.length > bestForSelector.length) bestForSelector = raw;
        }
        if (bestForSelector) {
          return bestForSelector;
        }
      }

      try {
        var rootText = cleanText(targetRoot.innerText || targetRoot.textContent || '');
        if (rootText && rootText.length > 120 && !isLikelyCanvasUiNoiseText(rootText)) return rootText;
      } catch (_) {}

      return '';
    }

    var isDocMode = canvasCountMode === 'doc';
    var docTextCandidate = getDocCanvasText(root);
    if (isDocMode) {
      if (docTextCandidate) {
        canvasTextSource = 'doc-dom';
        return docTextCandidate;
      }
      canvasTextSource = 'none-doc';
      return '';
    }

    var monacoAgeMs = canvasMonacoLastAt ? (Date.now() - canvasMonacoLastAt) : Number.POSITIVE_INFINITY;
    if (canvasMonacoText && typeof canvasMonacoText === 'string' && monacoAgeMs <= CANVAS_MONACO_STALE_MS) {
      canvasTextSource = 'monaco';
      return canvasMonacoText;
    }

    var editor = findVisibleCanvasNode(CANVAS_EDITOR_SELECTORS, root);
    if (editor) {
      try {
        var lines = deepQuery('.monaco-editor .view-lines', editor) || deepQuery('.view-lines', editor);
        var rawLines = lines ? cleanText(lines.innerText || lines.textContent || '') : '';
        if (rawLines && !isLikelyCanvasUiNoiseText(rawLines)) {
          canvasTextSource = 'dom-lines';
          return rawLines;
        }
      } catch (_) {}

      var editorText = '';
      try { editorText = cleanText(editor.innerText || editor.textContent || ''); } catch (_) {}
      if (editorText && !isLikelyCanvasUiNoiseText(editorText)) {
        canvasTextSource = 'dom-editor';
        return editorText;
      }
    }

    if (docTextCandidate) {
      canvasTextSource = 'doc-dom-auto';
      return docTextCandidate;
    }

    canvasTextSource = 'none-code';
    return '';
  }

  function scheduleCanvasScan(root, immediate) {
    clearTimeout(canvasDebounceTimer);
    var target = root || canvasRoot || getCanvasRoot();
    var delay = immediate ? 0 : CANVAS_DEBOUNCE_MS;
    canvasDebounceTimer = setTimeout(function() {
      if (!target) return;
      requestCanvasMonacoText(target);
      var text = getCanvasEditorText(target);
      if (!text) {
        if (canvasTokens !== 0) {
          canvasTokens = 0;
          canvasLastSignature = '';
          scheduleRecalc();
        }
        return;
      }
      if (text.length > CANVAS_MAX_CHARS) {
        text = text.slice(0, CANVAS_MAX_CHARS);
      }
      var isCode = false;
      try { isCode = !!deepQuery('[data-test-id="code-editor"], xap-code-editor, .monaco-editor', target); } catch (_) {}
      var signature = getCanvasSignature(text, isCode, canvasCountMode);
      if (signature === canvasLastSignature) return;
      canvasLastSignature = signature;

      var tokenText = (canvasCountMode === 'code') ? ('```\n' + text + '\n```') : text;
      try {
        canvasTokens = Tokenizer && Tokenizer.countTextTokens
          ? Tokenizer.countTextTokens(tokenText)
          : 0;
      } catch (_) {
        canvasTokens = 0;
      }
      debugCanvasSnapshot({
        seq: ++canvasDebugSeq,
        event: 'canvas-scan',
        source: canvasTextSource,
        textLen: text.length,
        tokens: canvasTokens,
        monacoLen: canvasMonacoText ? canvasMonacoText.length : 0,
        monacoAgeMs: canvasMonacoLastAt ? (Date.now() - canvasMonacoLastAt) : null,
        bridgeInjected: canvasBridgeInjected,
        hasRoot: !!canvasRoot,
        mode: canvasCountMode,
      });
      scheduleRecalc();
    }, delay);
  }

  function hookCanvasObserver() {
    if (!currentChatId) {
      if (canvasObserver) {
        try { canvasObserver.disconnect(); } catch (_) {}
        canvasObserver = null;
      }
      if (canvasRoot || canvasTokens || canvasLastSignature || canvasMonacoText) {
        canvasRoot = null;
        canvasTokens = 0;
        canvasLastSignature = '';
        canvasMonacoText = '';
        canvasMonacoLastAt = 0;
        canvasTextSource = 'none-gated';
        scheduleRecalc();
      }
      return;
    }

    var root = getCanvasRoot();
    if (!root) {
      if (canvasObserver) {
        try { canvasObserver.disconnect(); } catch (_) {}
        canvasObserver = null;
      }
      if (canvasRoot) {
        canvasRoot = null;
        canvasTokens = 0;
        canvasLastSignature = '';
        canvasMonacoText = '';
        canvasMonacoLastAt = 0;
        canvasTextSource = 'none';
        scheduleRecalc();
      }
      return;
    }
    if (root === canvasRoot && canvasObserver) return;
    if (canvasObserver) {
      try { canvasObserver.disconnect(); } catch (_) {}
    }
    canvasMonacoText = '';
    canvasMonacoLastAt = 0;
    canvasLastSignature = '';
    canvasRoot = root;
    ensureCanvasBridgeInjected();
    canvasObserver = new MutationObserver(function() {
      scheduleCanvasScan(canvasRoot, false);
    });
    canvasObserver.observe(canvasRoot, { childList: true, characterData: true, subtree: true });
    scheduleCanvasScan(canvasRoot, true);
  }

  function startObserver() {
    var observer = new MutationObserver(function(mutations) {
      var relevant = mutations.some(function(m) {
        return m.addedNodes.length > 0 || m.removedNodes.length > 0 || m.type === 'characterData';
      });
      if (relevant) {
        // Re-scan for new file inputs, draft input, and send buttons on every DOM change
        checkUrlChange();         // detect SPA chat navigation
        scanAndHookFileInputs(document);
        hookDraftInput();
        hookSendButtons();
        hookCanvasObserver();
        scheduleDockCheck();
        scheduleRecalc();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Draft input listener Ã¢â‚¬â€ targeted, not document-wide Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  var hookedDraftInput = null;

  /**
   * Attach the input listener ONLY to Gemini's actual prompt element.
   * Re-called on MutationObserver ticks so it picks up the element if
   * Gemini re-renders it (SPA navigation between conversations).
   */
  function hookDraftInput() {
    var el = queryFirst(SELECTORS.draftInput);
    if (!el || el === hookedDraftInput) return;

    // Remove listener from old element if it changed
    if (hookedDraftInput) {
      hookedDraftInput.removeEventListener('input', onDraftInput);
      hookedDraftInput.removeEventListener('keydown', onDraftKeydown);
    }

    hookedDraftInput = el;
    el.addEventListener('input',   onDraftInput);
    el.addEventListener('keydown', onDraftKeydown);
  }

  /** Called on every keystroke inside the draft box. */
  function onDraftInput() {
    // Unfreeze as soon as the user types in the box again
    draftFrozen = false;
    scheduleRecalc();
  }

  /**
   * Detect Enter (send) keypress.
   * Shift+Enter = newline (do NOT freeze).
   * Plain Enter  = send    (freeze draft immediately).
   */
  function onDraftKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      freezeDraft();
    }
  }

  /**
   * Also hook the send button (SVG button near the input).
   * Gemini renders several possible send button patterns.
   */
  var SEND_BUTTON_SELECTORS = [
    'button[aria-label*="Send"]',
    'button[data-test-id*="send"]',
    'button.send-button',
    '[aria-label="Send message"]',
    'send-button',
    'button[jsaction*="send"]',
  ];

  var hookedSendButtons = new WeakSet();

  function hookSendButtons() {
    for (var i = 0; i < SEND_BUTTON_SELECTORS.length; i++) {
      try {
        var btns = deepQueryAll(SEND_BUTTON_SELECTORS[i], document);
        for (var j = 0; j < btns.length; j++) {
          if (hookedSendButtons.has(btns[j])) continue;
          hookedSendButtons.add(btns[j]);
          btns[j].addEventListener('click', freezeDraft);
        }
      } catch (_) {}
    }
  }

  /**
   * Freeze draft: immediately zero out the displayed draft count
   * and block recalculate() from reading the input box until it clears.
   */
  function freezeDraft() {
    draftFrozen = true;
    if (totalFileTokens > 0) {
      pendingSendAttachmentTokens = totalFileTokens;
      pendingSendAttachmentSignature = getUploadSignature();
      pendingSendAttachmentAt = Date.now();
      debugLogOnce('Pending send snapshot', currentChatId + ':' + pendingSendAttachmentSignature, {
        chatId: currentChatId,
        tokens: pendingSendAttachmentTokens,
        signature: pendingSendAttachmentSignature,
      });
    }
    persistSentAttachments();

    // Force the UI to show 0 draft tokens right now, before the async
    // recalculate cycle completes, so the number snaps to 0 instantly.
    var panel = document.getElementById('gtm-panel');
    if (panel) {
      var el = document.getElementById('gtm-draft');
      if (el) el.textContent = '0';
    }

    // Poll until the input is actually empty (clears after send animation)
    var poll = setInterval(function() {
      var inputEl = queryFirst(SELECTORS.draftInput);
      var content = inputEl ? (inputEl.innerText || inputEl.value || '').trim() : '';
      if (content === '') {
        draftFrozen = false;
        clearInterval(poll);
        scheduleRecalc();
      }
    }, 100);

    // Safety: unfreeze after 3s even if polling never sees empty
    setTimeout(function() {
      draftFrozen = false;
      clearInterval(poll);
    }, 3000);
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Theme synchronization Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  /**
   * Watches the <html> and <body> elements for Gemini's dark-mode class/attribute
   * changes and mirrors the theme onto the panel via data-theme="dark".
   * Must be called after TokenMeterUI.inject() so the panel already exists.
   */
  var themeSyncStarted = false;
  var themeSyncCheck = null;

  function initThemeSync() {
    if (!themeSyncCheck) {
      themeSyncCheck = function() {
        const panel = document.getElementById('gtm-panel');
        if (!panel) return;

        const bgColor = window.getComputedStyle(document.body).backgroundColor;
        const rgb = bgColor.match(/\d+/g);

        if (rgb && rgb.length >= 3) {
          const r = parseInt(rgb[0], 10);
          const g = parseInt(rgb[1], 10);
          const b = parseInt(rgb[2], 10);

          // Standard mathematical formula for perceived brightness
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;

          if (brightness < 128) {
            panel.setAttribute('data-theme', 'dark');
          } else {
            panel.removeAttribute('data-theme');
          }
        }
      };
    }

    themeSyncCheck(); // Run on initialization

    if (themeSyncStarted) return;
    themeSyncStarted = true;

    // Observe the document root and body for any style or class mutations
    const observer = new MutationObserver(themeSyncCheck);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  }

  function init() {
    currentChatId = getChatIdFromUrl();  // snapshot starting chat
    lastPlanDetectHref = window.location.href;
    purgeOldTokenEntries();              // clean up entries older than 30 days
    // Restore any saved file tokens for the chat we're starting on
    loadFileTokens(currentChatId, function(stored) {
      if (stored > 0) {
        totalFileTokens = stored;
        attachmentInteractionSeen = true;
        if (isDebugEnabled()) console.log('[GTM] Init: restored', stored, 'file tokens for chat', currentChatId);
      }
      loadHistoryAttachmentTokens(currentChatId, function(historyStored) {
        storedHistoryAttachmentTokens = historyStored || 0;
        historyAttachmentLoaded = true;
        if (storedHistoryAttachmentTokens > 0) {
          if (isDebugEnabled()) console.log('[GTM] Init: restored', storedHistoryAttachmentTokens,
            'history attachment tokens for chat', currentChatId);
        } else {
          startAttachmentBackfill(currentChatId);
        }
      });
    });
    TokenMeterUI.inject();
    initThemeSync();   // mirror Gemini dark/light mode onto the panel
    scheduleDockCheck();
    loadCanvasCountMode();
    setupCanvasCountModeListener();
    window.addEventListener('resize', scheduleDockCheck, { passive: true });
    window.addEventListener('scroll', scheduleDockCheck, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleDockCheck, { passive: true });
      window.visualViewport.addEventListener('scroll', scheduleDockCheck, { passive: true });
    }
    startObserver();
    hookDragDrop();
    hookPaste();
    hookFileRemoval();
    hookFileRemovalAngular();
    document.addEventListener('visibilitychange', handleVisibilityPlanRefresh);
    schedulePlanDetectionBurst();
    scanAndHookFileInputs(document);
    hookDraftInput();
    hookSendButtons();
    hookCanvasObserver();
    setTimeout(recalculate, 900);
    syncInterval = setInterval(recalculate, 5000);
  }

  if (document.body) { init(); }
  else { document.addEventListener('DOMContentLoaded', init); }

})();


