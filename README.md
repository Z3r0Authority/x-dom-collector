# X DOM Collector (MVP)

X DOM Collector is a **Manifest V3 Chrome extension** that watches what is rendered on X/Twitter pages and stores a structured local dataset in IndexedDB.

At a high level, it does four things:

1. **Collects post data from the DOM** while you browse X/Twitter.
2. **Normalizes each observation into capture/interaction records** (not just unique posts).
3. **Persists everything locally** in IndexedDB (inside the extension).
4. **Provides a local dashboard + JSONL export** for quick analysis.

> MVP note: this is intentionally lightweight and heuristic-based. It is built for local collection and exploration, not full-fidelity platform analytics.

---

## What the application does

### 1) Collects visible posts in real time
The content script (`content.js`) observes the page for added `<article>` nodes and extracts fields from tweet/status links and nearby elements:

- `post_id`
- `url`
- `author_handle`
- `text` (from `div[lang]`)
- `posted_at` (from `<time datetime>`)

It also tags each capture with context inferred from the current path:

- `home`
- `search`
- `profile`
- `status`
- `unknown`

On Home, it additionally attempts to detect active feed tab (`home_for_you`, `home_following`, fallback `home_unknown`).

### 2) Batches and sends captures to the service worker
To reduce Manifest V3 service worker churn, the content script batches events and flushes:

- every ~3 seconds, or
- when 25 items are buffered.

Each batch entry contains:

- a `post` object (upsert target), and
- a `capture` object (append-only observation record).

### 3) Stores normalized data in IndexedDB
The background service worker (`background.js`) receives batches and writes to `xCollectorDB` via helpers in `db.js`.

Object stores:

- `posts` (key: `post_id`) – canonical post record
- `users` (key: `handle`) – author profile-lite rollup
- `captures` (auto id) – every appearance/observation of a post
- `interactions` (auto id) – graph-friendly interaction rows

This means you can analyze both:

- **unique posts**, and
- **how often/where they appeared**.

### 4) Infers simple interaction structure
When viewing a `/status/:id` page, any captured post whose `post_id` differs from the root status id is classified as:

- `interaction_type = "comment"`
- `parent_post_id = root_status_id`

Otherwise, interaction type defaults to `post`.

This is a practical MVP heuristic for building reply/comment-style threading structure.

### 5) Computes deterministic sentiment (MVP)
The service worker applies simple keyword scoring against post text:

- output score: `sentiment_score` in `[-1, +1]`
- output label: `positive`, `neutral`, or `negative`

It is **not context-aware NLP** and should be treated as a rough signal only.

### 6) Provides a local analytics dashboard and export
`dashboard.html` + `dashboard.js` read from IndexedDB and expose:

- captures per day
- top authors by captures
- home feed breakdown (`for_you` vs `following` etc.)
- sentiment summary
- posts by exact author handle
- JSONL export for last N days

JSONL export writes one JSON object per line with:

- post fields
- optional sentiment fields
- aggregated capture counts by feed category

---

## Architecture overview

- **`content.js`**: DOM observation + extraction + batching
- **`background.js`**: batch receiver, upserts, sentiment enrichment
- **`db.js`**: IndexedDB schema/open helpers
- **`dashboard.html/js/css`**: local reporting UI + export controls
- **`manifest.json`**: MV3 wiring (permissions, content script, service worker)

Data flow:

1. X page renders posts.
2. Content script extracts and buffers observations.
3. Batched message sent to service worker.
4. Service worker upserts `posts/users`, appends `captures/interactions`.
5. Dashboard queries IndexedDB and displays aggregates.

---

## Installation (development)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (the one containing `manifest.json`)

The extension runs on:

- `https://x.com/*`
- `https://twitter.com/*`

---

## Permissions and data location

- Permission used: `storage`
- Host permissions: X/Twitter domains above
- All collected data is stored locally in the extension IndexedDB database: `xCollectorDB`

No external backend is included in this MVP.

---

## MVP limitations

- DOM selectors may break if X/Twitter changes markup.
- Sentiment is keyword-based only.
- Reply/comment inference is heuristic-based for status pages.
- Author lookups in dashboard are exact-handle matching.
- This is a collector/explorer, not a complete analytics platform.

