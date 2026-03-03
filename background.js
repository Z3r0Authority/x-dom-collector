importScripts("db.js");

function computeSentiment(text) {
  const t = (text || "").toLowerCase();

  const pos = ["good","great","excellent","love","like","win","winning","awesome","nice","amazing","success","safe","secure","correct","true"];
  const neg = ["bad","terrible","awful","hate","fail","failing","loss","broken","scam","fraud","danger","unsafe","insecure","wrong","false","corrupt"];

  let score = 0;
  for (const w of pos) if (t.includes(w)) score += 1;
  for (const w of neg) if (t.includes(w)) score -= 1;

  if (score > 5) score = 5;
  if (score < -5) score = -5;

  const norm = score / 5;

  let label = "neutral";
  if (norm >= 0.2) label = "positive";
  else if (norm <= -0.2) label = "negative";

  return { sentiment_score: norm, sentiment_label: label };
}

async function upsertBatch(batch) {
  if (!Array.isArray(batch) || batch.length === 0) return;

  const db = await openDb();

  function upsertUser(usersStore, handle, nowIso) {
    if (!handle) return;

    const req = usersStore.get(handle);
    req.onsuccess = () => {
      const existing = req.result;
      if (!existing) {
        usersStore.put({
          handle,
          first_seen_at: nowIso,
          last_seen_at: nowIso,
          seen_count: 1
        });
        return;
      }

      usersStore.put({
        ...existing,
        first_seen_at: (existing.first_seen_at && existing.first_seen_at < nowIso) ? existing.first_seen_at : nowIso,
        last_seen_at: (existing.last_seen_at && existing.last_seen_at > nowIso) ? existing.last_seen_at : nowIso,
        seen_count: (existing.seen_count || 0) + 1
      });
    };
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction(["posts", "captures", "users", "interactions"], "readwrite");
    const posts = tx.objectStore("posts");
    const caps = tx.objectStore("captures");
    const users = tx.objectStore("users");
    const interactions = tx.objectStore("interactions");

    for (const item of batch) {
      const post = item?.post;
      const capture = item?.capture;
      if (!post?.post_id || !capture?.post_id) continue;

      const actor_handle = post.author_handle || capture.author_handle || null;
      const nowIso = capture.captured_at || new Date().toISOString();

      const s = computeSentiment(post.text || "");
      post.sentiment_score = s.sentiment_score;
      post.sentiment_label = s.sentiment_label;
      capture.sentiment_score = s.sentiment_score;
      capture.sentiment_label = s.sentiment_label;

      if (post.author_handle && !capture.author_handle) capture.author_handle = post.author_handle;

      upsertUser(users, actor_handle, nowIso);

      interactions.add({
        post_id: post.post_id,
        parent_post_id: capture.parent_post_id || null,
        actor_handle,
        interaction_type: capture.interaction_type || "post",
        context: capture.context || null,
        feed: capture.feed || null,
        session_id: capture.session_id || null,
        captured_at: nowIso
      });

      const getReq = posts.get(post.post_id);
      getReq.onsuccess = () => {
        const existing = getReq.result;

        if (!existing) {
          posts.put(post);
        } else {
          const merged = { ...existing };

          if (post.first_seen_at && (!merged.first_seen_at || post.first_seen_at < merged.first_seen_at)) {
            merged.first_seen_at = post.first_seen_at;
          }
          if (post.first_seen_context && !merged.first_seen_context) merged.first_seen_context = post.first_seen_context;

          if (!merged.text && post.text) merged.text = post.text;
          if (!merged.url && post.url) merged.url = post.url;
          if (!merged.author_handle && post.author_handle) merged.author_handle = post.author_handle;
          if (!merged.posted_at && post.posted_at) merged.posted_at = post.posted_at;

          merged.sentiment_score = post.sentiment_score;
          merged.sentiment_label = post.sentiment_label;

          posts.put(merged);
        }

        caps.add(capture);
      };
      getReq.onerror = () => { caps.add(capture); };
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  try { db.close(); } catch (e) {}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "NEW_POST_CAPTURE_BATCH") {
    const batch = msg.payload?.batch || [];
    upsertBatch(batch)
      .then(() => sendResponse({ ok: true, count: batch.length }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

/**
 * Open dashboard in a new tab when the extension icon is clicked.
 * (Requires manifest.json action WITHOUT default_popup.)
 */
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("dashboard.html")
  });
});
