function isoCutoff(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function withCursorByCapturedAt(store, cutoffIso, onRow, onDone, onErr) {
  let idx = null;
  try { idx = store.index("captured_at"); } catch (e) { idx = null; }

  const range = IDBKeyRange.lowerBound(cutoffIso);
  const req = idx ? idx.openCursor(range) : store.openCursor();

  req.onsuccess = () => {
    const cur = req.result;
    if (!cur) return onDone();
    const v = cur.value || {};
    if (!idx && v.captured_at && v.captured_at < cutoffIso) { cur.continue(); return; }
    onRow(v);
    cur.continue();
  };
  req.onerror = () => onErr(req.error);
}

function countCapturesByDay(days = 30) {
  const cutoff = isoCutoff(days);
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(["captures"], "readonly");
    const store = tx.objectStore("captures");
    const counts = new Map();

    withCursorByCapturedAt(
      store,
      cutoff,
      (v) => {
        const d = (v.captured_at || "").slice(0, 10);
        counts.set(d, (counts.get(d) || 0) + 1);
      },
      () => {
        try { db.close(); } catch(e) {}
        const out = Array.from(counts.entries()).sort((a,b) => a[0].localeCompare(b[0]))
          .map(([day, count]) => ({ day, count }));
        resolve(out);
      },
      (err) => { try { db.close(); } catch(e) {} reject(err); }
    );
  }));
}

function topAuthorsByCaptures(days = 30, limit = 20) {
  const cutoff = isoCutoff(days);
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(["captures"], "readonly");
    const store = tx.objectStore("captures");
    const counts = new Map();

    withCursorByCapturedAt(
      store,
      cutoff,
      (v) => {
        const h = v.author_handle || "unknown";
        counts.set(h, (counts.get(h) || 0) + 1);
      },
      () => {
        try { db.close(); } catch(e) {}
        const out = Array.from(counts.entries())
          .sort((a,b) => b[1] - a[1])
          .slice(0, limit)
          .map(([author_handle, capture_count]) => ({ author_handle, capture_count }));
        resolve(out);
      },
      (err) => { try { db.close(); } catch(e) {} reject(err); }
    );
  }));
}

function homeFeedBreakdown(days = 30) {
  const cutoff = isoCutoff(days);
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(["captures"], "readonly");
    const store = tx.objectStore("captures");

    const out = {
      home_for_you: { total: 0, unique_session: 0 },
      home_following: { total: 0, unique_session: 0 },
      home_unknown: { total: 0, unique_session: 0 },
      other: { total: 0, unique_session: 0 }
    };

    withCursorByCapturedAt(
      store,
      cutoff,
      (v) => {
        const feed = v.feed || null;
        const key = (feed === "home_for_you" || feed === "home_following" || feed === "home_unknown")
          ? feed
          : (v.context === "home" ? "home_unknown" : "other");

        out[key].total += 1;
        if (v.is_first_in_session) out[key].unique_session += 1;
      },
      () => { try { db.close(); } catch(e) {} resolve(out); },
      (err) => { try { db.close(); } catch(e) {} reject(err); }
    );
  }));
}

function postsByAuthor(authorHandle, limit = 50) {
  const handle = (authorHandle || "").trim();
  if (!handle) return Promise.resolve([]);
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(["posts"], "readonly");
    const store = tx.objectStore("posts");
    let idx = null;
    try { idx = store.index("author_handle"); } catch (e) { idx = null; }

    const req = idx ? idx.openCursor(IDBKeyRange.only(handle)) : store.openCursor();
    const out = [];

    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) { try { db.close(); } catch(e) {} resolve(out); return; }

      const v = cur.value;
      if (!idx && v.author_handle !== handle) { cur.continue(); return; }

      out.push({
        post_id: v.post_id,
        author_handle: v.author_handle,
        posted_at: v.posted_at,
        first_seen_at: v.first_seen_at,
        url: v.url,
        sentiment_label: v.sentiment_label,
        sentiment_score: v.sentiment_score,
        text: (v.text || "").slice(0, 240)
      });

      if (out.length >= limit) { try { db.close(); } catch(e) {} resolve(out); return; }
      cur.continue();
    };
    req.onerror = () => { try { db.close(); } catch(e) {} reject(req.error); };
  }));
}

function sentimentSummary(days = 30) {
  const cutoff = isoCutoff(days);
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(["captures"], "readonly");
    const store = tx.objectStore("captures");

    const totals = { positive: 0, neutral: 0, negative: 0, unknown: 0 };
    const sums = { positive: 0, neutral: 0, negative: 0, unknown: 0 };

    withCursorByCapturedAt(
      store,
      cutoff,
      (v) => {
        const raw = v.sentiment_label || "unknown";
        const label = (raw === "positive" || raw === "neutral" || raw === "negative") ? raw : "unknown";
        const score = (typeof v.sentiment_score === "number") ? v.sentiment_score : 0;
        totals[label] += 1;
        sums[label] += score;
      },
      () => {
        try { db.close(); } catch(e) {}
        const avg = {};
        for (const k of Object.keys(totals)) avg[k] = totals[k] ? (sums[k] / totals[k]) : null;
        resolve({ days, cutoff, totals, avg_score: avg });
      },
      (err) => { try { db.close(); } catch(e) {} reject(err); }
    );
  }));
}

function exportJsonl(days = 30) {
  const cutoff = isoCutoff(days);

  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(["captures", "posts"], "readonly");
    const caps = tx.objectStore("captures");
    const posts = tx.objectStore("posts");

    const capStats = new Map();
    const labelStats = new Map();

    withCursorByCapturedAt(
      caps,
      cutoff,
      (v) => {
        const pid = v.post_id;
        if (!pid) return;

        if (!capStats.has(pid)) capStats.set(pid, { total: 0, home_for_you: 0, home_following: 0, home_unknown: 0, other: 0 });
        const s = capStats.get(pid);
        s.total += 1;

        if (v.feed === "home_for_you") s.home_for_you += 1;
        else if (v.feed === "home_following") s.home_following += 1;
        else if (v.feed === "home_unknown") s.home_unknown += 1;
        else s.other += 1;

        if (v.sentiment_label) labelStats.set(pid, { sentiment_label: v.sentiment_label, sentiment_score: v.sentiment_score });
      },
      () => {
        const outLines = [];
        const req = posts.openCursor();

        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) { try { db.close(); } catch(e) {} resolve(outLines.join("\n")); return; }

          const p = cur.value;
          const stats = capStats.get(p.post_id);
          if (stats) {
            const extra = labelStats.get(p.post_id) || {};
            outLines.push(JSON.stringify({ ...p, ...extra, capture_counts: stats }));
          }
          cur.continue();
        };

        req.onerror = () => { try { db.close(); } catch(e) {} reject(req.error); };
      },
      (err) => { try { db.close(); } catch(e) {} reject(err); }
    );
  }));
}

function setPre(id, obj) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = (typeof obj === "string") ? obj : JSON.stringify(obj, null, 2);
}

document.getElementById("refreshCaptures")?.addEventListener("click", async () => {
  const days = parseInt(document.getElementById("daysCaptures")?.value || "30", 10);
  setPre("capturesOut", await countCapturesByDay(days));
});

document.getElementById("refreshAuthors")?.addEventListener("click", async () => {
  const days = parseInt(document.getElementById("daysAuthors")?.value || "30", 10);
  const limit = parseInt(document.getElementById("limitAuthors")?.value || "20", 10);
  setPre("authorsOut", await topAuthorsByCaptures(days, limit));
});

document.getElementById("refreshFeed")?.addEventListener("click", async () => {
  const days = parseInt(document.getElementById("daysFeed")?.value || "30", 10);
  setPre("feedOut", await homeFeedBreakdown(days));
});

document.getElementById("refreshSentiment")?.addEventListener("click", async () => {
  const days = parseInt(document.getElementById("daysSentiment")?.value || "30", 10);
  setPre("sentimentOut", await sentimentSummary(days));
});

document.getElementById("loadPosts")?.addEventListener("click", async () => {
  const h = document.getElementById("authorHandle")?.value || "";
  const limit = parseInt(document.getElementById("limitPosts")?.value || "50", 10);
  setPre("postsOut", await postsByAuthor(h, limit));
});

document.getElementById("exportBtn")?.addEventListener("click", async () => {
  const days = parseInt(document.getElementById("daysExport")?.value || "30", 10);
  const jsonl = await exportJsonl(days);

  const blob = new Blob([jsonl], { type: "application/jsonl;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `x-dom-collector-export-${days}d.jsonl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
});

(async function init() {
  try {
    setPre("capturesOut", await countCapturesByDay(30));
    setPre("authorsOut", await topAuthorsByCaptures(30, 20));
    setPre("feedOut", await homeFeedBreakdown(30));
    setPre("sentimentOut", await sentimentSummary(30));
  } catch (e) {
    console.error(e);
  }
})();
