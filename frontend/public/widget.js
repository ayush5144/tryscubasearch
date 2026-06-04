/*!
 * ScubaSearch Widget v1.0.0
 * Embeddable AI-powered search for OTT and content platforms.
 * Zero dependencies. Self-contained.
 *
 * Usage:
 *   <script src="widget.js"
 *     data-api-key="sk_live_..."
 *     data-placeholder="Search titles..."
 *     data-max-results="8"
 *     data-theme="light">
 *   </script>
 *
 * CSP note: add  connect-src https://api.scubasearch.io  to your Content-Security-Policy header.
 */
(function () {
  "use strict";

  // ─── Constants ──────────────────────────────────────────────────────────────
  var API_BASE = "https://api.scubasearch.io/api/v1";
  var SEARCH_URL = API_BASE + "/search";
  var CLICK_URL = API_BASE + "/search/click";
  var SETTLE_URL = API_BASE + "/search/settle";
  var SEARCH_DEBOUNCE_MS = 100; // live results — keep snappy
  var SNAPSHOT_DEBOUNCE_MS = 400; // word-boundary snapshot — independent timer
  var MIN_QUERY_LEN = 2;
  var SETTLE_IDLE_MS = 5000;
  var BROWSE_RESUME_MS = 1200;

  // ─── IIFE-scope state ───────────────────────────────────────────────────────
  var lastLogId = null;
  var sessionBuffer = [];
  var queryMeta = {};
  var sessionHadEngagement = false;
  var snapshotDebounceTimer = null;

  // ─── Session ID (one per settled session lifecycle) ────────────────────────
  function newSessionId() {
    return (
      "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36)
    );
  }

  var _sessionId = newSessionId();

  function getSessionId() {
    return _sessionId;
  }

  // ─── Read config from script tag ────────────────────────────────────────────
  var scriptEl =
    document.currentScript ||
    (function () {
      var scripts = document.querySelectorAll("script[data-api-key]");
      return scripts[scripts.length - 1] || null;
    })();

  if (!scriptEl) {
    return;
  }

  var API_KEY = scriptEl.getAttribute("data-api-key") || "";
  var PLACEHOLDER =
    scriptEl.getAttribute("data-placeholder") || "Search titles...";
  var MAX_RESULTS =
    parseInt(scriptEl.getAttribute("data-max-results"), 10) || 8;
  var THEME = scriptEl.getAttribute("data-theme") || "light";
  var LAYOUT = scriptEl.getAttribute("data-layout") || "dropdown"; // "dropdown" | "grid"
  var ATTACHED = scriptEl.getAttribute("data-attached") !== "false"; // true = flush, false = floating gap
  var RADIUS = (function () {
    var val = parseInt(scriptEl.getAttribute("data-radius"), 10);
    if (isNaN(val) || val < 0) return 6;
    return Math.min(val, 24);
  })(); // px — controls roundness of dropdown + cards (0=sharp, 24=pill)
  var SEMANTIC_RATIO = (function () {
    var val = parseFloat(scriptEl.getAttribute("data-semantic-ratio"));
    if (isNaN(val)) return 0.5;
    return Math.max(0, Math.min(1, val));
  })();
  var HEADLESS = scriptEl.getAttribute("data-headless") === "true"; // true = skip dropdown, event-only
  // data-api-base overrides the default production URL — useful for local dev
  var apiBase = (scriptEl.getAttribute("data-api-base") || API_BASE).replace(
    /\/$/,
    "",
  );
  SEARCH_URL = apiBase + "/search";
  CLICK_URL = apiBase + "/search/click";
  SETTLE_URL = apiBase + "/search/settle";

  if (!API_KEY) {
    return;
  }

  // ─── Theme colours ──────────────────────────────────────────────────────────
  var THEMES = {
    light: {
      bg: "#ffffff",
      text: "#333333",
      border: "#dddddd",
      hoverBg: "#f5f5f5",
      metaText: "#888888",
      shadow: "0 4px 12px rgba(0,0,0,0.12)",
    },
    dark: {
      bg: "#1a1a1a",
      text: "#f0f0f0",
      border: "#444444",
      hoverBg: "#2a2a2a",
      metaText: "#aaaaaa",
      shadow: "0 4px 12px rgba(0,0,0,0.4)",
    },
  };

  var colours = THEMES[THEME] || THEMES.light;

  // ─── Inject styles ──────────────────────────────────────────────────────────
  function injectStyles() {
    var css = [
      ".scs-wrapper{position:relative;display:inline-block;width:100%;}",
      ".scs-dropdown{",
      "position:absolute;",
      ATTACHED ? "top:100%;" : "top:calc(100% + 8px);",
      "left:0;",
      "right:0;",
      "z-index:999999;",
      "background:" + colours.bg + ";",
      "border:1px solid " + colours.border + ";",
      ATTACHED ? "border-top:none;" : "",
      ATTACHED
        ? "border-radius:0 0 " + RADIUS + "px " + RADIUS + "px;"
        : "border-radius:" + RADIUS + "px;",
      "box-shadow:" + colours.shadow + ";",
      "max-height:400px;",
      "overflow-y:auto;",
      "display:none;",
      "}",
      ".scs-result{",
      "display:flex;",
      "align-items:center;",
      "gap:10px;",
      "padding:8px 12px;",
      "cursor:pointer;",
      "text-decoration:none;",
      "color:" + colours.text + ";",
      "border-bottom:1px solid " + colours.border + ";",
      "}",
      ".scs-result:last-child{border-bottom:none;}",
      ".scs-result:hover{background:" + colours.hoverBg + ";}",
      ".scs-img-wrap{",
      "flex-shrink:0;",
      "width:40px;",
      "height:40px;",
      "overflow:hidden;",
      "border-radius:" + Math.round(RADIUS * 0.67) + "px;",
      "background:#e0e0e0;",
      "display:flex;",
      "align-items:center;",
      "justify-content:center;",
      "}",
      ".scs-img{width:40px;height:40px;object-fit:cover;display:block;}",
      ".scs-img-placeholder{width:40px;height:40px;background:#cccccc;border-radius:" +
        Math.round(RADIUS * 0.67) +
        "px;}",
      ".scs-info{flex:1;min-width:0;}",
      ".scs-title{",
      "font-size:14px;",
      "font-weight:500;",
      "color:" + colours.text + ";",
      "white-space:nowrap;",
      "overflow:hidden;",
      "text-overflow:ellipsis;",
      "margin:0;",
      "line-height:1.3;",
      "}",
      ".scs-meta{",
      "font-size:13px;",
      "color:" + colours.metaText + ";",
      "margin:2px 0 0 0;",
      "line-height:1.2;",
      "}",
      ".scs-empty{",
      "padding:12px;",
      "text-align:center;",
      "color:" + colours.metaText + ";",
      "font-size:14px;",
      "}",
      // Grid layout styles
      ".scs-dropdown.scs-grid-layout{",
      "display:none;",
      "padding:12px;",
      "min-width:480px;",
      "left:0;",
      "right:auto;",
      "}",
      ".scs-grid-layout .scs-grid{",
      "display:grid;",
      "grid-template-columns:repeat(3,1fr);",
      "gap:10px;",
      "}",
      ".scs-card{",
      "display:flex;",
      "flex-direction:column;",
      "text-decoration:none;",
      "color:" + colours.text + ";",
      "border:1px solid " + colours.border + ";",
      "border-radius:" + RADIUS + "px;",
      "overflow:hidden;",
      "transition:box-shadow 0.15s;",
      "}",
      ".scs-card:hover{box-shadow:0 2px 8px rgba(0,0,0,0.12);}",
      ".scs-card-img{",
      "width:100%;",
      "aspect-ratio:1;",
      "object-fit:cover;",
      "background:#e0e0e0;",
      "display:block;",
      "}",
      ".scs-card-img-ph{",
      "width:100%;",
      "aspect-ratio:1;",
      "background:#e0e0e0;",
      "}",
      ".scs-card-info{padding:6px 8px;}",
      ".scs-card-title{",
      "font-size:12px;",
      "font-weight:500;",
      "color:" + colours.text + ";",
      "overflow:hidden;",
      "display:-webkit-box;",
      "-webkit-line-clamp:2;",
      "-webkit-box-orient:vertical;",
      "margin:0 0 2px 0;",
      "line-height:1.3;",
      "}",
      ".scs-card-meta{",
      "font-size:12px;",
      "color:" + colours.metaText + ";",
      "margin:0;",
      "}",
    ].join("");

    var style = document.createElement("style");
    style.setAttribute("data-scs", "1");
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─── Session buffer helpers ──────────────────────────────────────────────────

  // snapshotQuery: add a query to the session buffer (deduped)
  function snapshotQuery(value) {
    if (!value) {
      return;
    }
    for (var i = 0; i < sessionBuffer.length; i++) {
      if (sessionBuffer[i].value === value) {
        return; // already in buffer — skip
      }
    }
    sessionBuffer.push({ value: value, timestamp: Date.now() });
  }

  // resetSession: clear buffer and engagement flag (called on first input after a reset)
  // Does NOT rotate _sessionId — only terminal signals (click/enter/visibilitychange) do that.
  // Idle settle is a checkpoint, not a session boundary.
  function resetSession() {
    sessionBuffer = [];
    queryMeta = {};
    sessionHadEngagement = false;
  }

  // ─── Build result element ────────────────────────────────────────────────────
  function buildResultEl(item, apiKey, inputRef, sendSettleFn) {
    var a = document.createElement("a");
    a.className = "scs-result";
    a.href = item.product_url || "#";

    // Image
    var imgWrap = document.createElement("div");
    imgWrap.className = "scs-img-wrap";
    if (item.image_url) {
      var img = document.createElement("img");
      img.className = "scs-img";
      img.src = item.image_url;
      img.alt = item.title || "";
      img.onerror = function () {
        imgWrap.removeChild(img);
        var ph = document.createElement("div");
        ph.className = "scs-img-placeholder";
        imgWrap.appendChild(ph);
      };
      imgWrap.appendChild(img);
    } else {
      var ph = document.createElement("div");
      ph.className = "scs-img-placeholder";
      imgWrap.appendChild(ph);
    }

    // Info
    var info = document.createElement("div");
    info.className = "scs-info";

    var titleEl = document.createElement("p");
    titleEl.className = "scs-title";
    titleEl.textContent = item.title || "";

    info.appendChild(titleEl);

    a.appendChild(imgWrap);
    a.appendChild(info);

    // Hover — mark engagement only (no separate settle signal)
    a.addEventListener("mouseenter", function () {
      sessionHadEngagement = true;
    });

    // Click tracking — capture lastLogId synchronously to avoid race
    // with in-flight search responses overwriting it via microtask
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var dest = item.product_url || null;
      var productId = item.id || item.product_id || "";
      var capturedLogId = lastLogId;

      if (productId && capturedLogId) {
        try {
          fetch(CLICK_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + apiKey,
            },
            body: JSON.stringify({
              product_id: String(productId),
              search_log_id: capturedLogId,
            }),
            keepalive: true,
          }).catch(function () {}); // fire-and-forget
        } catch (err) {
          // never propagate
        }
      }

      sendSettleFn("click");

      if (dest) {
        window.location.href = dest;
      }
    });

    return a;
  }

  // ─── Build grid card element ─────────────────────────────────────────────────
  function buildCardEl(item, apiKey, sendSettleFn) {
    var a = document.createElement("a");
    a.className = "scs-card";
    a.href = item.product_url || "#";

    if (item.image_url) {
      var img = document.createElement("img");
      img.className = "scs-card-img";
      img.src = item.image_url;
      img.alt = item.title || "";
      img.onerror = function () {
        var ph = document.createElement("div");
        ph.className = "scs-card-img-ph";
        a.insertBefore(ph, img);
        a.removeChild(img);
      };
      a.appendChild(img);
    } else {
      var imgPh = document.createElement("div");
      imgPh.className = "scs-card-img-ph";
      a.appendChild(imgPh);
    }

    var info = document.createElement("div");
    info.className = "scs-card-info";

    var titleEl = document.createElement("p");
    titleEl.className = "scs-card-title";
    titleEl.textContent = item.title || "";
    info.appendChild(titleEl);

    a.appendChild(info);

    a.addEventListener("mouseenter", function () {
      sessionHadEngagement = true;
    });

    a.addEventListener("click", function (e) {
      e.preventDefault();
      var dest = item.product_url || null;
      var productId = item.id || item.product_id || "";
      var capturedLogId = lastLogId;
      if (productId && capturedLogId) {
        try {
          fetch(CLICK_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + apiKey,
            },
            body: JSON.stringify({
              product_id: String(productId),
              search_log_id: capturedLogId,
            }),
            keepalive: true,
          }).catch(function () {});
        } catch (err) {}
      }
      sendSettleFn("click");
      if (dest) window.location.href = dest;
    });

    return a;
  }

  // ─── Widget init (runs after DOM ready) ─────────────────────────────────────
  function init() {
    // Find input
    var input =
      document.querySelector('input[type="search"]') ||
      (function () {
        var all = document.querySelectorAll("input");
        for (var i = 0; i < all.length; i++) {
          var ph = (all[i].placeholder || "").toLowerCase();
          if (ph.indexOf("search") !== -1) {
            return all[i];
          }
        }
        return null;
      })();

    if (!input) {
      return;
    }

    // Clear any browser-restored value on fresh page load
    input.value = "";

    // Set placeholder if not already set
    if (!input.placeholder) {
      input.placeholder = PLACEHOLDER;
    }

    // Wrap input in position:relative container (not needed in headless mode)
    if (!HEADLESS) {
      var parent = input.parentNode;
      var wrapper = document.createElement("div");
      wrapper.className = "scs-wrapper";
      parent.insertBefore(wrapper, input);
      wrapper.appendChild(input);
    }

    // Create dropdown (skipped in headless mode)
    var dropdown = HEADLESS
      ? null
      : (function () {
          var d = document.createElement("div");
          d.className =
            LAYOUT === "grid" ? "scs-dropdown scs-grid-layout" : "scs-dropdown";
          wrapper.appendChild(d);
          return d;
        })();

    if (!HEADLESS) {
      injectStyles();
    }

    // ── State ─────────────────────────────────────────────────────────────────
    var debounceTimer = null;
    var activeRequest = null; // used to abort stale requests
    var isVisible = false;
    lastLogId = null;
    var settleTimer = null;
    var browseResumeTimer = null;
    var hoveringResults = false;
    var sessionStarted = false; // tracks whether session has been started
    var sessionSettled = false; // once true, no more settles from this session
    var destroyed = false; // set by destroy(), kills all widget activity
    // window.ScubaSearch.engage() — platforms call this from their own result hover handlers
    // in headless mode to signal engagement.
    // window.ScubaSearch.click(productId) — platforms call this when a viewer clicks a result
    // in headless mode to record the click.
    window.ScubaSearch = window.ScubaSearch || {};
    window.ScubaSearch.engage = function () {
      if (destroyed || sessionSettled) return;
      sessionHadEngagement = true;
    };
    window.ScubaSearch.click = function (productId) {
      if (destroyed || sessionSettled) return;
      if (!productId) return;
      var capturedLogId = lastLogId;
      if (capturedLogId) {
        try {
          fetch(CLICK_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + API_KEY,
            },
            body: JSON.stringify({
              product_id: String(productId),
              search_log_id: capturedLogId,
            }),
            keepalive: true,
          }).catch(function () {});
        } catch (err) {}
      }
      sendSettle("click");
    };
    window.ScubaSearch.destroy = function () {
      destroyed = true;
      sessionSettled = true;
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (browseResumeTimer) {
        clearTimeout(browseResumeTimer);
        browseResumeTimer = null;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };

    function markBrowseActivity() {
      if (destroyed || sessionSettled || !sessionStarted) return;
      sessionHadEngagement = true;
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      if (browseResumeTimer) {
        clearTimeout(browseResumeTimer);
      }
      browseResumeTimer = setTimeout(function () {
        browseResumeTimer = null;
        scheduleSettle();
      }, BROWSE_RESUME_MS);
    }

    // ── sendSettle ────────────────────────────────────────────────────────────
    // Sends the session buffer and resets state. signal: "idle"|"enter"|"click"|"visibilitychange"
    function sendSettle(signal) {
      if (destroyed || sessionSettled) return;

      // Always snapshot the current query before sending
      snapshotQuery(input.value.trim());

      // Nothing to send if no log_id and no buffer entries
      if (!lastLogId && sessionBuffer.length === 0) {
        return;
      }

      // Terminal signals — once a click, enter, or tab-switch settles, session is done.
      if (
        signal === "click" ||
        signal === "enter" ||
        signal === "visibilitychange"
      ) {
        sessionSettled = true;
      }

      var capturedSessionId = getSessionId();

      var payload = {
        log_id: lastLogId,
        session_id: capturedSessionId,
        queries: sessionBuffer.slice(), // copy
        query_meta: queryMeta,
        signal: signal || "idle",
        engagement: sessionHadEngagement,
      };

      try {
        fetch(SETTLE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + API_KEY,
          },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(function () {}); // fire-and-forget, never surface errors
      } catch (err) {
        // never propagate
      }

      // Reset session state after sending
      sessionBuffer = [];
      sessionHadEngagement = false;
      sessionStarted = false;
      hoveringResults = false;
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      if (browseResumeTimer) {
        clearTimeout(browseResumeTimer);
        browseResumeTimer = null;
      }

      // Rotate session ID only after the current terminal payload is sent.
      if (
        signal === "click" ||
        signal === "enter" ||
        signal === "visibilitychange"
      ) {
        _sessionId = newSessionId();
      }
    }

    // ── scheduleSettle ────────────────────────────────────────────────────────
    function scheduleSettle() {
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      if (hoveringResults) {
        return;
      }
      if (!lastLogId) {
        return;
      }
      settleTimer = setTimeout(function () {
        sendSettle("idle");
        settleTimer = null;
      }, SETTLE_IDLE_MS);
    }

    function showDropdown() {
      if (!dropdown) return;
      dropdown.style.display = "block";
      isVisible = true;
    }

    function hideDropdown() {
      if (!dropdown) return;
      dropdown.style.display = "none";
      isVisible = false;
    }

    function renderResults(results) {
      if (!dropdown) return;
      var frag = document.createDocumentFragment();
      if (!results || results.length === 0) {
        var empty = document.createElement("div");
        empty.className = "scs-empty";
        empty.textContent = "No results found";
        frag.appendChild(empty);
      } else if (LAYOUT === "grid") {
        var grid = document.createElement("div");
        grid.className = "scs-grid";
        for (var i = 0; i < results.length; i++) {
          grid.appendChild(buildCardEl(results[i], API_KEY, sendSettle));
        }
        frag.appendChild(grid);
      } else {
        for (var i = 0; i < results.length; i++) {
          frag.appendChild(
            buildResultEl(results[i], API_KEY, input, sendSettle),
          );
        }
      }
      dropdown.replaceChildren(frag);
      showDropdown();
    }

    // ── Scroll on results container — mark engagement only ───────────────────
    if (dropdown) {
      dropdown.addEventListener("mouseenter", function () {
        if (!sessionStarted) return;
        hoveringResults = true;
        markBrowseActivity();
      });
      dropdown.addEventListener("mouseleave", function () {
        hoveringResults = false;
        scheduleSettle();
      });
      dropdown.addEventListener("scroll", function () {
        markBrowseActivity();
      });
    }

    // ── Search ────────────────────────────────────────────────────────────────
    function doSearch(query) {
      if (destroyed) return;
      // Abort in-flight request if any (best-effort via flag)
      var thisRequest = {};
      var startedAt = Date.now();
      activeRequest = thisRequest;

      try {
        fetch(SEARCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + API_KEY,
          },
          body: JSON.stringify({
            query: query,
            limit: MAX_RESULTS,
            semantic_ratio: SEMANTIC_RATIO,
          }),
        })
          .then(function (res) {
            if (activeRequest !== thisRequest) {
              return;
            }
            return res.json();
          })
          .then(function (data) {
            if (!data) {
              return;
            } // stale / aborted
            if (activeRequest !== thisRequest) {
              return;
            }
            var resultCount = (data.results || []).length;
            queryMeta[query] = {
              result_count: resultCount,
              cache_hit: !!data.cache_hit,
              response_ms: Math.max(0, Date.now() - startedAt),
            };
            lastLogId = data.log_id || null;

            // Dispatch scubasearch:results event — fires on every search (headless or not)
            try {
              window.dispatchEvent(
                new CustomEvent("scubasearch:results", {
                  detail: {
                    query: query,
                    results: data.results || [],
                    total: resultCount,
                    cache_hit: data.cache_hit || false,
                    log_id: data.log_id || null,
                  },
                }),
              );
            } catch (err) {}

            if (HEADLESS) {
              // Engagement is signalled by the platform via window.ScubaSearch.engage()
              // from their own result card hover handlers — no page-level listeners needed.
              scheduleSettle();
              return; // skip dropdown rendering entirely
            }
            renderResults(data.results || []);
            scheduleSettle();
          })
          .catch(function (err) {
            if (activeRequest !== thisRequest) {
              return;
            }
            console.error("[ScubaSearch] fetch error:", err);
            hideDropdown();
          });
      } catch (err) {
        console.error("[ScubaSearch] unexpected error:", err);
        hideDropdown();
      }
    }

    // ── Event: keydown — space trigger ────────────────────────────────────────
    input.addEventListener("keydown", function (e) {
      // Enter submit — handle on keydown to avoid losing the signal when
      // focus/navigation side-effects prevent keyup from firing.
      if (e.key === "Enter" || e.keyCode === 13) {
        if (lastLogId || sessionBuffer.length > 0) {
          clearTimeout(settleTimer);
          settleTimer = null;
          snapshotQuery(input.value.trim());
          sendSettle("enter");
        }
        return;
      }

      if (e.key === " ") {
        snapshotQuery(input.value.trim());
      }
    });

    // ── Event: keyup (debounced + Enter handling) ─────────────────────────────
    input.addEventListener("keyup", function (e) {
      // Enter key — settle immediately, cancel pending idle timer
      if (e.key === "Enter" || e.keyCode === 13) {
        if (lastLogId || sessionBuffer.length > 0) {
          clearTimeout(settleTimer);
          settleTimer = null;
          snapshotQuery(input.value.trim());
          sendSettle("enter");
        }
        return;
      }

      clearTimeout(debounceTimer);
      clearTimeout(snapshotDebounceTimer);
      clearTimeout(settleTimer); // cancel idle timer — new search is starting
      settleTimer = null;
      var query = input.value.trim();

      if (query.length < MIN_QUERY_LEN) {
        hideDropdown();
        // In headless mode, fire empty results so the consumer clears UI
        if (HEADLESS) {
          window.dispatchEvent(
            new CustomEvent("scubasearch:results", {
              detail: {
                query: query,
                results: [],
                total: 0,
                cache_hit: false,
                log_id: null,
              },
            }),
          );
        }
        return;
      }

      // Start a new session on first input (or after previous session settled)
      if (!sessionStarted || sessionSettled) {
        resetSession();
        sessionStarted = true;
        sessionSettled = false;
      }

      // Search debounce — 200ms, keeps results snappy
      debounceTimer = setTimeout(function () {
        doSearch(query);
      }, SEARCH_DEBOUNCE_MS);

      // Snapshot debounce — 400ms, independent of search
      snapshotDebounceTimer = setTimeout(function () {
        snapshotQuery(query);
      }, SNAPSHOT_DEBOUNCE_MS);
    });

    // Fallback: if user is actively browsing results and presses Enter while
    // focus is outside the input, still treat it as a deliberate search submit.
    function onGlobalKeyDown(e) {
      if (e.key !== "Enter" && e.keyCode !== 13) return;
      if (e.target === input) return;
      if (!isVisible || !sessionStarted || sessionSettled) return;
      if (!lastLogId && sessionBuffer.length === 0) return;
      clearTimeout(settleTimer);
      settleTimer = null;
      snapshotQuery(input.value.trim());
      sendSettle("enter");
    }
    document.addEventListener("keydown", onGlobalKeyDown);

    // ── Event: blur — hide after 150ms so click fires first ──────────────────
    input.addEventListener("blur", function () {
      setTimeout(function () {
        hideDropdown();
      }, 150);
    });

    // ── Event: focus — re-show if there are results and query is long enough ──
    input.addEventListener("focus", function () {
      var query = input.value.trim();
      if (
        dropdown &&
        query.length >= MIN_QUERY_LEN &&
        dropdown.childNodes.length > 0
      ) {
        showDropdown();
      }
    });

    // ── visibilitychange — send buffer when page goes hidden ─────────────────
    function onVisibilityChange() {
      if (destroyed || sessionSettled) return;
      if (document.visibilityState === "hidden" && sessionStarted) {
        snapshotQuery(input.value.trim());
        sendSettle("visibilitychange");
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    var originalDestroy = window.ScubaSearch.destroy;
    window.ScubaSearch.destroy = function () {
      document.removeEventListener("keydown", onGlobalKeyDown);
      originalDestroy();
    };
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
