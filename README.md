# X DOM Collector (MVP)

Captures X/Twitter posts from the DOM (content script), batches them, writes to IndexedDB (service worker),
and provides a simple dashboard + JSONL export + basic deterministic sentiment.

## Install (Dev)
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the folder containing `manifest.json`

## Storage
IndexedDB database: `xCollectorDB`

Object stores:
- `posts` (key: `post_id`)
- `captures` (auto-increment key: `id`)

A "capture" is one appearance of a post while you browse (Home / Search / Profile / Status).

## Batching
`content.js` buffers and sends batches every ~3 seconds (or 25 items), reducing MV3 service worker churn.

## Sentiment (MVP)
Deterministic keyword scoring in `background.js`:
- `sentiment_score` in [-1..+1]
- `sentiment_label` in {positive, neutral, negative}

Not context-aware. Placeholder for real NLP later.
