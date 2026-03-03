(() => {
  const sessionId =
    (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const seenThisSession = new Set();

  const buffer = [];
  const MAX_BATCH_SIZE = 25;
  const FLUSH_INTERVAL_MS = 3000;
  let flushInFlight = false;

  function getContext() {
    const path = location.pathname || "/";
    if (path.startsWith("/search")) return "search";
    if (path.startsWith("/home")) return "home";
    if (/^\/[A-Za-z0-9_]+$/.test(path)) return "profile";
    if (/^\/[^/]+\/status\/\d+/.test(path)) return "status";
    return "unknown";
  }

  function detectHomeFeed() {
    if (!location.pathname.startsWith("/home")) return null;
    const tablists = document.querySelectorAll('[role="tablist"]');
    for (const tl of tablists) {
      const selected = tl.querySelector('[role="tab"][aria-selected="true"]');
      if (!selected) continue;
      const t = (selected.textContent || "").trim().toLowerCase();
      if (t.includes("for you") || t.includes("for-you") || t.includes("foryou")) return "home_for_you";
      if (t.includes("following")) return "home_following";
      return "home_unknown";
    }
    return "home_unknown";
  }

  function getStatusRootPostId() {
    const m = (location.pathname || "").match(/^\/[^/]+\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function extractFromArticle(article) {
    const statusLink = article.querySelector('a[href*="/status/"]');
    if (!statusLink) return null;

    const href = statusLink.getAttribute("href") || "";
    const m = href.match(/\/status\/(\d+)/);
    if (!m) return null;

    const post_id = m[1];
    const url = new URL(href, location.origin).toString();

    let author_handle = null;
    const handleMatch = href.match(/^\/([^/]+)\/status\/\d+/);
    if (handleMatch) author_handle = "@" + handleMatch[1];

    let text = "";
    const langDiv = article.querySelector("div[lang]");
    if (langDiv) text = (langDiv.innerText || "").trim();

    const timeEl = article.querySelector("time[datetime]");
    const posted_at = timeEl?.getAttribute("datetime") || null;

    return { post_id, url, author_handle, text, posted_at };
  }

  function queueCapture(extracted) {
    const nowIso = new Date().toISOString();
    const context = getContext();
    const statusRootPostId = (context === "status") ? getStatusRootPostId() : null;
    const feed = (context === "home") ? (detectHomeFeed() || "home_unknown") : null;
    const context_feed = feed ? `${context}:${feed}` : context;

    const inferredInteractionType =
      (context === "status" && statusRootPostId && extracted.post_id !== statusRootPostId)
        ? "comment"
        : "post";

    const parent_post_id = (inferredInteractionType === "comment") ? statusRootPostId : null;

    const isFirstInSession = !seenThisSession.has(extracted.post_id);
    if (isFirstInSession) seenThisSession.add(extracted.post_id);

    const post = {
      post_id: extracted.post_id,
      url: extracted.url,
      author_handle: extracted.author_handle,
      text: extracted.text || "",
      posted_at: extracted.posted_at,
      first_seen_at: nowIso,
      first_seen_context: context
    };

    const capture = {
      post_id: extracted.post_id,
      author_handle: extracted.author_handle,
      captured_at: nowIso,
      context,
      feed,
      context_feed,
      session_id: sessionId,
      is_first_in_session: isFirstInSession,
      interaction_type: inferredInteractionType,
      parent_post_id
    };

    buffer.push({ post, capture });

    if (buffer.length >= MAX_BATCH_SIZE) flushBatch();
  }

  function handleArticle(article) {
    const extracted = extractFromArticle(article);
    if (!extracted) return;
    queueCapture(extracted);
  }

  function processNode(node) {
    if (!(node instanceof Element)) return;

    if (node.tagName === "ARTICLE") {
      handleArticle(node);
      return;
    }

    const articles = node.querySelectorAll?.("article");
    if (!articles) return;
    for (const a of articles) handleArticle(a);
  }

  function flushBatch() {
    if (flushInFlight) return;
    if (!buffer.length) return;

    flushInFlight = true;
    const batch = buffer.splice(0, buffer.length);

    chrome.runtime.sendMessage({ type: "NEW_POST_CAPTURE_BATCH", payload: { batch } }, () => {
      if (chrome.runtime.lastError) buffer.unshift(...batch);
      flushInFlight = false;
    });
  }

  function bootstrapScan() {
    document.querySelectorAll("article").forEach(handleArticle);
  }

  function start() {
    bootstrapScan();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) processNode(n);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(() => flushBatch(), FLUSH_INTERVAL_MS);

    window.addEventListener("beforeunload", () => { flushBatch(); });
  }

  start();
})();
