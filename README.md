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
- `users` (key: `handle`)
- `captures` (auto-increment key: `id`)
- `interactions` (auto-increment key: `id`)

A "capture" is one appearance of a post while you browse (Home / Search / Profile / Status).

An "interaction" is a normalized event used for graph-style joins later:
- `interaction_type`: currently `post` or inferred `comment`
- `actor_handle`: user connected to that interaction
- `post_id` + optional `parent_post_id` to support comment/reply threading

Current inference rule for `comment` (MVP): when viewing a `/status/:id` page, any captured article whose `post_id` differs from the root status id is marked as `interaction_type = "comment"` with `parent_post_id = root_status_id`.

## Batching
`content.js` buffers and sends batches every ~3 seconds (or 25 items), reducing MV3 service worker churn.

## Sentiment (MVP)
Deterministic keyword scoring in `background.js`:
- `sentiment_score` in [-1..+1]
- `sentiment_label` in {positive, neutral, negative}

Not context-aware. Placeholder for real NLP later.
