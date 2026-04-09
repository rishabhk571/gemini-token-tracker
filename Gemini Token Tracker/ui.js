/**
 * ui.js
 * Builds and manages the Token Meter overlay panel.
 * Depends on: tokenizer.js (must be loaded first)
 */

const TokenMeterUI = (() => {
  const PANEL_ID = "gtm-panel";
  const CANVAS_MODE_KEY = "gtm_canvas_mode";
  const CANVAS_MODE_CODE = "code";
  const CANVAS_MODE_DOC = "doc";
  const SHOW_PLAN_DETECTION_DEBUG = false; // temporary UI toggle
  let currentCanvasMode = CANVAS_MODE_CODE;
  let lastPulseAt = 0;

  function fmtLimit(limit = 0) {
    const n = Number(limit) || 0;
    if (n >= 1_000_000)
      return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2) + "M";
    if (n >= 1_000) return Math.round(n / 1_000) + "k";
    return String(n);
  }

  function normalizeCanvasMode(mode) {
    return mode === CANVAS_MODE_DOC ? CANVAS_MODE_DOC : CANVAS_MODE_CODE;
  }

  function setCanvasModeUI(mode) {
    currentCanvasMode = normalizeCanvasMode(mode);
    const toggle = document.getElementById("gtm-canvas-toggle");
    const sub = document.getElementById("gtm-canvas-mode-sub");
    if (!toggle) return;
    const isCode = currentCanvasMode === CANVAS_MODE_CODE;
    toggle.textContent = isCode ? "Code" : "Doc";
    toggle.title = isCode
      ? "Code projects (HTML/CSS/JS) - 2.5 chars/token"
      : "Normal writing (notes, docs) - 4 chars/token";
    if (sub) {
      sub.textContent = isCode
        ? "Code projects (HTML/CSS/JS)"
        : "Normal writing (notes, docs)";
    }
  }

  // ─── SVG Arc helpers ──────────────────────────────────────────────────────

  /**
   * Generates the SVG <path> `d` attribute for a circular arc (clockwise).
   * @param {number} cx  Centre X
   * @param {number} cy  Centre Y
   * @param {number} r   Radius
   * @param {number} pct Fill fraction 0–1
   */
  function arcPath(cx, cy, r, pct) {
    const clampedPct = Math.min(Math.max(pct, 0), 0.9999);
    const angle = clampedPct * 2 * Math.PI;
    const startX = cx;
    const startY = cy - r;
    const endX = cx + r * Math.sin(angle);
    const endY = cy - r * Math.cos(angle);
    const largeArc = angle > Math.PI ? 1 : 0;

    return `M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY}`;
  }

  // ─── State colour map ─────────────────────────────────────────────────────

  const STATE_COLORS = {
    safe: { stroke: "#1a73e8", text: "#1a73e8", bg: "rgba(26,115,232,0.08)" },
    warn: { stroke: "#f9ab00", text: "#f9ab00", bg: "rgba(249,171,0,0.08)" },
    alert: { stroke: "#d93025", text: "#d93025", bg: "rgba(217,48,37,0.08)" },
    full: { stroke: "#8b0000", text: "#8b0000", bg: "rgba(139,0,0,0.15)" },
  };

  function getPlanSourceLabel(source) {
    switch (source) {
      case "manual-override":
        return "manual override";
      case "profile":
        return "profile menu";
      case "pillbox":
        return "plan pillbox";
      case "model":
        return "model label";
      case "cache-paid":
        return "paid cache";
      case "cache-free":
        return "free cache";
      case "downgrade-blocked":
        return "cache safeguard";
      case "generic-upgrade":
        return "upgrade prompt";
      case "no-signal":
        return "no signal";
      default:
        return source ? source.replace(/-/g, " ") : "unknown signal";
    }
  }

  function getPlanConfidenceLabel(confidence) {
    switch (confidence) {
      case "high":
        return "Strong";
      case "medium":
        return "Medium";
      case "manual":
        return "Manual";
      case "cached":
        return "Cached";
      default:
        return "Low";
    }
  }

  function buildPlanSignalIndicator(data) {
    const tier = String(data.tier || "Unknown");
    const source = String(data.tierSource || "").toLowerCase();
    const confidence = String(data.tierConfidence || "low").toLowerCase();
    const signal = String(data.tierSignal || "").trim();

    if ((source === "init" || source === "unknown") && !signal && tier === "Unknown") {
      return null;
    }
    if (!source && !signal && tier === "Unknown") return null;

    const sourceLabel = getPlanSourceLabel(source);
    const confidenceLabel = getPlanConfidenceLabel(confidence);
    const suffix = signal ? ` (${signal})` : "";
    return {
      badge: "Plan",
      text: `${confidenceLabel}: ${sourceLabel} -> ${tier}${suffix}`,
      title: `Plan detection winner: ${sourceLabel}. Confidence: ${confidenceLabel}.${signal ? ` Signal: ${signal}.` : ""}`,
      confidence,
    };
  }

  // ─── Panel HTML template ──────────────────────────────────────────────────

  function buildPanelHTML() {
    return `
      <div id="${PANEL_ID}" class="gtm-floating-root" data-corner="bottom-right">
        <button id="gtm-fab" class="gtm-fab" type="button" aria-label="Open Gemini token meter">
          <span class="gtm-fab-center" aria-hidden="true"></span>
        </button>
        <div id="gtm-expanded-panel" class="gtm-panel gtm-expanded-panel" aria-hidden="true">
          <div class="gtm-header">
            <span class="gtm-title">Usage Metadata</span>
            <div class="gtm-header-actions">
              <span class="gtm-mode-badge" id="gtm-mode-badge" title="Counting mode">~</span>
            </div>
          </div>

          <div id="gtm-body">
            <div class="gtm-body-inner">
              <div id="gtm-source-shell" class="gtm-source-shell" aria-hidden="true">
                <div class="gtm-source-shell-inner">
                  <div id="gtm-source-stack" class="gtm-source-stack">
                    <div id="gtm-plan-row" class="gtm-source-row gtm-hidden">
                      <span class="gtm-source-chip" id="gtm-plan-chip">Plan</span>
                      <span class="gtm-source-text" id="gtm-plan-text"></span>
                    </div>
                    <div id="gtm-source-row" class="gtm-source-row">
                      <span class="gtm-source-chip" id="gtm-source-chip">Estimator</span>
                      <span class="gtm-source-text" id="gtm-source-text"></span>
                    </div>
                  </div>
                  <button
                    id="gtm-history-clear"
                    class="gtm-history-clear gtm-hidden"
                    type="button"
                    title="Clear the persisted history attachment tokens for this chat"
                  >Clear attachment cache</button>
                </div>
              </div>

              <div class="gtm-progress-row">
                <div class="gtm-progress-labels">
                  <span id="gtm-pct-label" class="gtm-pct-text">0%</span>
                  <span id="gtm-used-label" class="gtm-used-text">0 / 128k</span>
                </div>
                <div id="gtm-progress-track" class="gtm-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                  <div id="gtm-progress-bar" class="gtm-progress-bar" style="width:0%"></div>
                </div>
              </div>

              <div class="gtm-stats-grid">
                <div class="gtm-stat-card gtm-stat-card-full">
                  <div class="gtm-stat-header">
                    <div class="gtm-stat-label">Canvas</div>
                    <button class="gtm-canvas-toggle" id="gtm-canvas-toggle" type="button" title="Canvas counting mode">Code</button>
                  </div>
                  <div class="gtm-stat-sub" id="gtm-canvas-mode-sub">Code projects (HTML/CSS/JS)</div>
                  <div class="gtm-stat-val" id="gtm-canvas">0</div>
                </div>
                <div class="gtm-stat-card">
                  <div class="gtm-stat-label">Draft (typing)</div>
                  <div class="gtm-stat-val" id="gtm-draft">0</div>
                </div>
                <div class="gtm-stat-card">
                  <div class="gtm-stat-label">You sent</div>
                  <div class="gtm-stat-val" id="gtm-input">0</div>
                </div>
                <div class="gtm-stat-card">
                  <div class="gtm-stat-label">Gemini replied</div>
                  <div class="gtm-stat-val" id="gtm-output">0</div>
                </div>
                <div class="gtm-stat-card">
                  <div class="gtm-stat-label">Gemini thinking</div>
                  <div class="gtm-stat-val" id="gtm-thinking">0</div>
                </div>
                <div class="gtm-stat-card">
                  <div class="gtm-stat-label">Files added</div>
                  <div class="gtm-stat-val" id="gtm-attachments">0</div>
                </div>
                <div class="gtm-stat-card">
                  <div class="gtm-stat-label" title="Last 20 messages">Messages (last 20)</div>
                  <div class="gtm-stat-val" id="gtm-history-count">0</div>
                </div>
              </div>

              <div id="gtm-alert-banner" class="gtm-alert-banner gtm-hidden">
                Context window nearly full
              </div>

              <button id="gtm-new-chat-btn" class="gtm-new-chat-btn" type="button">Start new chat</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ─── Inject panel into page ───────────────────────────────────────────────

  function inject() {
    if (document.getElementById(PANEL_ID)) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = buildPanelHTML();
    document.body.appendChild(wrapper.firstElementChild);

    const panel = document.getElementById(PANEL_ID);
    const expandedPanel = document.getElementById("gtm-expanded-panel");
    const fab = document.getElementById("gtm-fab");
    const canvasToggle = document.getElementById("gtm-canvas-toggle");
    const newChatBtn = document.getElementById("gtm-new-chat-btn");

    if (!panel || !expandedPanel || !fab) return;

    const POS_KEY = "gtm_floating_position_v1";
    const EDGE_GAP = 18;
    const FAB_SIZE = 56;
    let open = false;
    let pointerDown = false;
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startLeft = 0;
    let startTop = 0;

    const clamp = (v, min, max) => Math.max(min, Math.min(v, max));

    const getMaxLeft = () =>
      Math.max(EDGE_GAP, window.innerWidth - FAB_SIZE - EDGE_GAP);
    const getMaxTop = () =>
      Math.max(EDGE_GAP, window.innerHeight - FAB_SIZE - EDGE_GAP);

    const getCurrentPos = () => ({
      left:
        parseFloat(panel.style.left) || window.innerWidth - FAB_SIZE - EDGE_GAP,
      top:
        parseFloat(panel.style.top) || window.innerHeight - FAB_SIZE - EDGE_GAP,
    });

    const setPosition = (left, top) => {
      const nextLeft = clamp(left, EDGE_GAP, getMaxLeft());
      const nextTop = clamp(top, EDGE_GAP, getMaxTop());
      panel.style.left = `${Math.round(nextLeft)}px`;
      panel.style.top = `${Math.round(nextTop)}px`;
    };

    const getCorner = () => {
      const pos = getCurrentPos();
      const centerX = pos.left + FAB_SIZE / 2;
      const centerY = pos.top + FAB_SIZE / 2;
      const isRight = centerX > window.innerWidth / 2;
      const isBottom = centerY > window.innerHeight / 2;
      if (isBottom && isRight) return "bottom-right";
      if (isBottom && !isRight) return "bottom-left";
      if (!isBottom && isRight) return "top-right";
      return "top-left";
    };

    const savePos = () => {
      try {
        const pos = getCurrentPos();
        localStorage.setItem(
          POS_KEY,
          JSON.stringify({ left: pos.left, top: pos.top }),
        );
      } catch (_) {}
    };

    const loadPos = () => {
      try {
        const raw = localStorage.getItem(POS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (
          !parsed ||
          !Number.isFinite(parsed.left) ||
          !Number.isFinite(parsed.top)
        )
          return null;
        return parsed;
      } catch (_) {
        return null;
      }
    };

    const snapToCorner = () => {
      const corner = getCorner();
      let left = EDGE_GAP;
      let top = EDGE_GAP;
      if (corner.includes("right")) left = getMaxLeft();
      if (corner.includes("bottom")) top = getMaxTop();
      setPosition(left, top);
      panel.setAttribute("data-corner", corner);
      savePos();
      positionExpandedPanel();
    };

    function positionExpandedPanel() {
      const corner = getCorner();
      panel.setAttribute("data-corner", corner);
      const gap = 10;
      const width = 280;
      const estimatedHeight = expandedPanel.offsetHeight || 420;
      const isRight = corner.includes("right");
      const isBottom = corner.includes("bottom");
      expandedPanel.style.left = isRight ? `${-(width - FAB_SIZE)}px` : "0px";
      expandedPanel.style.top = isBottom
        ? `${-(estimatedHeight + gap)}px`
        : `${FAB_SIZE + gap}px`;

      // Clamp panel to viewport after base placement.
      const rect = expandedPanel.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (rect.left < EDGE_GAP) dx = EDGE_GAP - rect.left;
      if (rect.right > window.innerWidth - EDGE_GAP)
        dx = window.innerWidth - EDGE_GAP - rect.right;
      if (rect.top < EDGE_GAP) dy = EDGE_GAP - rect.top;
      if (rect.bottom > window.innerHeight - EDGE_GAP)
        dy = window.innerHeight - EDGE_GAP - rect.bottom;
      expandedPanel.style.setProperty("--gtm-expand-x", `${Math.round(dx)}px`);
      expandedPanel.style.setProperty("--gtm-expand-y", `${Math.round(dy)}px`);
    }

    function setOpen(nextOpen) {
      open = !!nextOpen;
      panel.classList.toggle("gtm-open", open);
      expandedPanel.setAttribute("aria-hidden", open ? "false" : "true");
      if (open) positionExpandedPanel();
    }

    const restorePos = loadPos();
    if (restorePos) {
      setPosition(restorePos.left, restorePos.top);
    } else {
      setPosition(
        window.innerWidth - FAB_SIZE - EDGE_GAP,
        window.innerHeight - FAB_SIZE - EDGE_GAP,
      );
    }
    panel.setAttribute("data-corner", getCorner());

    const bindCanvasToggle = () => {
      if (!canvasToggle || canvasToggle._gtmBound) return;
      canvasToggle._gtmBound = true;
      canvasToggle.addEventListener("click", () => {
        const next =
          currentCanvasMode === CANVAS_MODE_CODE
            ? CANVAS_MODE_DOC
            : CANVAS_MODE_CODE;
        setCanvasModeUI(next);
        try {
          if (
            window.__gtmTokenMeterDebug &&
            typeof window.__gtmTokenMeterDebug.setCanvasMode === "function"
          ) {
            window.__gtmTokenMeterDebug.setCanvasMode(next);
          } else if (chrome && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ [CANVAS_MODE_KEY]: next });
          }
        } catch (_) {}
      });
    };

    fab.addEventListener("pointerdown", (ev) => {
      pointerDown = true;
      dragging = false;
      dragStartX = ev.clientX;
      dragStartY = ev.clientY;
      const pos = getCurrentPos();
      startLeft = pos.left;
      startTop = pos.top;
      try {
        fab.setPointerCapture(ev.pointerId);
      } catch (_) {}
    });

    fab.addEventListener("pointermove", (ev) => {
      if (!pointerDown) return;
      const dx = ev.clientX - dragStartX;
      const dy = ev.clientY - dragStartY;
      if (!dragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) dragging = true;
      if (!dragging) return;
      setOpen(false);
      setPosition(startLeft + dx, startTop + dy);
      panel.setAttribute("data-corner", getCorner());
    });

    fab.addEventListener("pointerup", (ev) => {
      if (!pointerDown) return;
      pointerDown = false;
      try {
        fab.releasePointerCapture(ev.pointerId);
      } catch (_) {}
      if (dragging) {
        dragging = false;
        snapToCorner();
        return;
      }
      setOpen(!open);
    });

    const resetPointerState = () => {
      pointerDown = false;
      dragging = false;
    };
    fab.addEventListener("pointercancel", resetPointerState);
    fab.addEventListener("lostpointercapture", resetPointerState);

    document.addEventListener(
      "pointerdown",
      (ev) => {
        if (!open) return;
        if (panel.contains(ev.target)) return;
        setOpen(false);
      },
      true,
    );

    window.addEventListener(
      "resize",
      () => {
        const pos = getCurrentPos();
        setPosition(pos.left, pos.top);
        if (open) positionExpandedPanel();
      },
      { passive: true },
    );

    if (newChatBtn) {
      newChatBtn.addEventListener("click", () => {
        const selectors = [
          'button[aria-label*="New chat"]',
          'a[aria-label*="New chat"]',
          '[data-test-id*="new-chat"]',
          'button[title*="New chat"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && typeof el.click === "function") {
            el.click();
            setOpen(false);
            return;
          }
        }
      });
    }

    // Canvas toggle initial sync (best-effort)
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([CANVAS_MODE_KEY], (result) => {
          setCanvasModeUI(result[CANVAS_MODE_KEY]);
        });
      }
    } catch (_) {}
    bindCanvasToggle();
  }

  // ─── Update panel with fresh data ─────────────────────────────────────────

  /**
   * @param {{
   *   total: number,
   *   input: number,
   *   output: number,
   *   thinkingTokens: number,
   *   draftTokens: number,
   *   historyCount: number,
   *   cost: { inputCost: string, outputCost: string, totalCost: string },
   *   tier?: string,
   *   tierConfidence?: string,
   *   tierSource?: string,
   *   tierSignal?: string,
   *   tierAmbiguous?: boolean,
   *   state: 'safe'|'warn'|'alert',
   *   pct: number
   * }} data
   */
  function update(data) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const limitVal = Number(data.limit) || 128000;
    const pct = Math.min((Number(data.total) || 0) / limitVal, 1.0);
    const tierName = String(data.tier || "Unknown");
    const tierConfidence = String(data.tierConfidence || "low").toLowerCase();
    const tierAmbiguous =
      !!data.tierAmbiguous || tierName === "Unknown" || tierConfidence === "low";

    if (data.canvasMode) {
      setCanvasModeUI(data.canvasMode);
    }

    let activeState = data.state || "safe";
    if (pct >= 1.0) activeState = "full";
    else if (pct >= 0.9) activeState = "alert";
    else if (pct >= 0.6) activeState = "warn";
    else activeState = "safe";

    const colors = STATE_COLORS[activeState] || STATE_COLORS.safe;

    // Mode badge
    const badge = document.getElementById("gtm-mode-badge");
    if (badge) {
      badge.textContent = data.apiMode ? "API" : "~";
      badge.title = data.apiMode
        ? "Pro accuracy via countTokens API"
        : "Heuristic mode (1 token / 4 chars)";
      badge.style.background = data.apiMode ? "#e6f4ea" : "#D8E2F0";
      badge.style.color = data.apiMode ? "#137333" : "#5F6F86";
    }

    const sourceShell = document.getElementById("gtm-source-shell");
    const sourceStack = document.getElementById("gtm-source-stack");
    const sourceRow = document.getElementById("gtm-source-row");
    const sourceChip = document.getElementById("gtm-source-chip");
    const sourceText = document.getElementById("gtm-source-text");
    const planRow = document.getElementById("gtm-plan-row");
    const planChip = document.getElementById("gtm-plan-chip");
    const planText = document.getElementById("gtm-plan-text");
    const planIndicator = buildPlanSignalIndicator(data);
    const hasPlanSignal = SHOW_PLAN_DETECTION_DEBUG && !!planIndicator;
    const hasEstimateSignal = !!data.estimateText;
    if (planRow && planChip && planText) {
      planRow.classList.toggle("gtm-hidden", !hasPlanSignal);
      if (hasPlanSignal) {
        planChip.textContent = planIndicator.badge;
        planChip.setAttribute("data-confidence", planIndicator.confidence || "low");
        planText.textContent = planIndicator.text;
        planRow.title = planIndicator.title || "";
      } else {
        planChip.textContent = "Plan";
        planChip.removeAttribute("data-confidence");
        planText.textContent = "";
        planRow.title = "";
      }
    }

    if (sourceShell && sourceRow && sourceChip && sourceText) {
      const shouldShowSourceShell = hasPlanSignal || hasEstimateSignal;
      if (shouldShowSourceShell) {
        sourceShell.classList.add("visible");
        sourceShell.setAttribute("aria-hidden", "false");
      } else {
        sourceShell.classList.remove("visible");
        sourceShell.setAttribute("aria-hidden", "true");
      }

      if (sourceStack) {
        sourceStack.classList.toggle("gtm-hidden", !shouldShowSourceShell);
      }
      sourceRow.classList.toggle("gtm-hidden", !hasEstimateSignal);

      if (hasEstimateSignal) {
        sourceChip.textContent = data.estimateBadge || "Estimator";
        sourceText.textContent = data.estimateText;
        sourceRow.title = data.estimateTitle || "";
      } else {
        sourceChip.textContent = "Estimator";
        sourceText.textContent = "";
        sourceRow.title = "";
      }
    } // Clear button - only shown when history-storage ghost attachment is active
    const clearBtn = document.getElementById("gtm-history-clear");
    if (clearBtn) {
      const isHistoryGhost =
        data.estimateText === "Persistent attachment" &&
        (data.attachmentTokens || 0) > 0;
      clearBtn.classList.toggle("gtm-hidden", !isHistoryGhost);

      // Bind click handler once; subsequent update() calls reuse it
      if (isHistoryGhost && !clearBtn._gtmClearBound) {
        clearBtn._gtmClearBound = true;
        clearBtn.addEventListener("click", function () {
          try {
            if (
              window.__gtmTokenMeterDebug &&
              typeof window.__gtmTokenMeterDebug.clearHistoryAttachment ===
                "function"
            ) {
              window.__gtmTokenMeterDebug.clearHistoryAttachment();
            }
          } catch (_) {}
        });
      }
    }

    // Arc (legacy donut - only runs if element exists)
    const arcEl = document.getElementById("gtm-arc");
    if (arcEl) {
      arcEl.setAttribute("d", arcPath(60, 60, 50, pct));
      arcEl.setAttribute("stroke", colors.stroke);
    }

    // Progress + labels
    const pctText = `${Math.round(pct * 100)}%`;

    const pctLabel = document.getElementById("gtm-pct-label");
    if (pctLabel) {
      pctLabel.textContent = pctText;
      pctLabel.style.color = colors.text;
    }

    const usedText = `${fmtNum(data.total)} / ${fmtLimit(limitVal)}`;

    const usedLabel = document.getElementById("gtm-used-label");
    if (usedLabel) {
      usedLabel.textContent = usedText;
    }

    const progressBar = document.getElementById("gtm-progress-bar");
    if (progressBar) {
      progressBar.style.width = `${Math.round(pct * 100)}%`;
      progressBar.style.background = colors.stroke;
    }

    const progressTrack = document.getElementById("gtm-progress-track");
    if (progressTrack) {
      progressTrack.setAttribute(
        "aria-valuenow",
        String(Math.round(pct * 100)),
      );
    }

    const fab = document.getElementById("gtm-fab");
    if (fab) {
      const percent = Math.round(Math.max(0, Math.min(pct, 1)) * 100);
      fab.style.setProperty("--gtm-progress-pct", `${percent}%`);
      fab.style.setProperty("--gtm-progress-color", colors.stroke);
      fab.setAttribute("title", `${percent}% context used`);
      const now = Date.now();
      if (percent >= 90 && now - lastPulseAt > 10000) {
        lastPulseAt = now;
        fab.classList.remove("gtm-pulse");
        // Force reflow so the animation can replay cleanly.
        void fab.offsetWidth;
        fab.classList.add("gtm-pulse");
        window.setTimeout(() => fab.classList.remove("gtm-pulse"), 1200);
      }
    }

    // Stats
    const setStatText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    setStatText("gtm-draft", fmtNum(data.draftTokens));
    const canvasEl = document.getElementById("gtm-canvas");
    if (canvasEl) canvasEl.textContent = fmtNum(data.canvasTokens || 0);
    setStatText("gtm-input", fmtNum(data.input));
    setStatText("gtm-output", fmtNum(data.output));
    setStatText("gtm-thinking", fmtNum(data.thinkingTokens));
    const attachEl = document.getElementById("gtm-attachments");
    if (attachEl) attachEl.textContent = fmtNum(data.attachmentTokens || 0);
    setStatText("gtm-history-count", fmtNum(data.historyCount));

    // Keep the panel border neutral instead of state-colored.
    panel.style.removeProperty("border-color");

    // Alert banner
    const banner = document.getElementById("gtm-alert-banner");
    if (!banner) return;

    if (activeState === "full") {
      let modeText = "Capacity Reached.";
      if (tierAmbiguous) {
        modeText = `Plan not confirmed: using ${fmtLimit(limitVal)} token estimate.`;
      } else if (limitVal >= 1000000) {
        modeText = "1M Token Capacity Filled: Full context utilized.";
      } else if (limitVal === 192000) {
        modeText = "Deep Think Capacity Reached: 192k token limit active.";
      } else if (limitVal >= 128000 && limitVal < 192000) {
        modeText = "Plus Capacity Reached: 128k token limit active.";
      } else {
        modeText = "Free Tier Limit Reached: 32k token capacity utilized.";
      }

      banner.classList.remove("gtm-hidden");
      banner.style.display = "block";
      banner.style.background = colors.bg;
      banner.style.color = colors.text;

      banner.innerHTML = `
        <div style="font-weight: 700;">Status: <span style="font-weight: 500;">Reading Capacity Reached</span></div>
        <div style="font-weight: 700;">Warning: <span style="font-weight: 500;">Detail Loss Likely</span></div>
        <div style="font-weight: 700;">Action: <span style="font-weight: 500;">Limit Reached. Upload smaller files</span></div>
        <div style="font-weight: 700;">Context: <span style="font-weight: 500;">${modeText}</span></div>
      `;
    } else if (activeState === "alert") {
      banner.classList.remove("gtm-hidden");
      banner.style.display = "block";
      banner.style.background = colors.bg;
      banner.style.color = colors.text;
      banner.innerHTML = tierAmbiguous
        ? "Status: Context window approaching limits (plan unconfirmed)"
        : "Status: Context window approaching limits";
    } else if (activeState === "warn") {
      banner.classList.remove("gtm-hidden");
      banner.style.display = "block";
      banner.style.background = colors.bg;
      banner.style.color = colors.text;
      banner.innerHTML = tierAmbiguous
        ? "Status: Context window at 60% capacity (plan unconfirmed)"
        : "Status: Context window at 60% capacity";
    } else {
      banner.classList.add("gtm-hidden");
      banner.style.display = "";
      banner.innerHTML = "";
    }
  }

  /** Format a number as compact: 1234 -> "1,234", 12345 -> "12.3k" */
  function fmtNum(n = 0) {
    const num = Number(n) || 0;
    if (num >= 1000) {
      const k = num / 1000;
      const precision = k >= 10 ? 0 : 1;
      const rounded = k.toFixed(precision).replace(/\.0$/, "");
      return `${rounded}k`;
    }
    return num.toLocaleString("en-IN");
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  return { inject, update };
})();
