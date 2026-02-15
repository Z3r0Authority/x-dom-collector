const XDC_DB_NAME = "xCollectorDB";
const XDC_DB_VERSION = 2;

// Schema:
// posts: keyPath post_id
// captures: keyPath id (autoIncrement)
// captures indexes: captured_at, post_id, author_handle, feed, session_id, context_feed

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(XDC_DB_NAME, XDC_DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("posts")) {
        const posts = db.createObjectStore("posts", { keyPath: "post_id" });
        posts.createIndex("author_handle", "author_handle", { unique: false });
        posts.createIndex("posted_at", "posted_at", { unique: false });
        posts.createIndex("first_seen_at", "first_seen_at", { unique: false });
      }

      if (!db.objectStoreNames.contains("captures")) {
        const caps = db.createObjectStore("captures", { keyPath: "id", autoIncrement: true });
        caps.createIndex("captured_at", "captured_at", { unique: false });
        caps.createIndex("post_id", "post_id", { unique: false });
        caps.createIndex("author_handle", "author_handle", { unique: false });
        caps.createIndex("feed", "feed", { unique: false });
        caps.createIndex("session_id", "session_id", { unique: false });
        caps.createIndex("context_feed", "context_feed", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Helper (dashboard/tools). Background uses its own batch writer.
function upsertPostAndCapture(post, capture) {
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["posts", "captures"], "readwrite");
      const posts = tx.objectStore("posts");
      const caps = tx.objectStore("captures");

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

          if (typeof post.sentiment_score === "number") merged.sentiment_score = post.sentiment_score;
          if (post.sentiment_label) merged.sentiment_label = post.sentiment_label;

          posts.put(merged);
        }

        if (post.author_handle && !capture.author_handle) capture.author_handle = post.author_handle;
        caps.add(capture);
      };
      getReq.onerror = () => {
        if (post.author_handle && !capture.author_handle) capture.author_handle = post.author_handle;
        caps.add(capture);
      };

      tx.oncomplete = () => { 
        try { db.close(); } catch(e) {}
        resolve(); 
      };
      tx.onerror = () => { 
        try { db.close(); } catch(e) {}
        reject(tx.error); 
      };
      tx.onabort = () => { 
        try { db.close(); } catch(e) {}
        reject(tx.error); 
      };
    });
  });
}
