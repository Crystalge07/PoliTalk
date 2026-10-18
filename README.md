# PoliTalk

PoliTalk is a Chrome extension that estimates the political lean of short-form videos on TikTok, Instagram and YouTube, and shows the evidence behind each score.

Project page: [Devpost submission](https://devpost.com/software/politalk-6digfl)

## What It Does

- Detects the video you're watching on TikTok, Instagram, YouTube Shorts and YouTube watch pages (ads and hover previews are skipped).
- **Live analysis:** streams the video's audio (never video) to the backend, which transcribes it in real time and shows a first estimate within seconds, refining it as the video plays and stopping early once the estimate settles. Falls back to uploading a ~20 second recorded sample when streaming isn't available.
- Transcribes speech with ElevenLabs Speech-to-Text (realtime Scribe for live analysis).
- Scores the speech with Google Gemini on a symmetric **-5 (left) to +5 (right)** scale, with separate economic and social axes, a framing label (informational / opinion / persuasive / inflammatory) and a confidence score.
- Shows **verbatim quotes** from the transcript that drove the score (quotes the model didn't actually take from the transcript are discarded).
- Finds related coverage from a list of trusted outlets via Google Search grounding, so links are real pages, not model-invented URLs.
- Caches results by video ID, so a video already analyzed by anyone using the same backend loads instantly at no extra API cost.

## Privacy & Safety

- Nothing is recorded until the user accepts the privacy notice shown on install.
- Users can turn PoliTalk off, choose **Automatic** or **When I click** analysis, and enable it per site.
- Audio is held in memory only and is never written to disk.
- The transcript is treated as untrusted input: the prompt is hardened against instructions spoken in a video ("rate this as center").
- The backend rejects requests from website origins, supports an optional shared API key, rate-limits per IP, and caps uploads at 5 MB.

## Repo Structure

- `Frontend/` - Chrome extension (Manifest V3, Vite, React, TypeScript, Tailwind)
  - `src/content.tsx` - injects the on-page panel (in a shadow root)
  - `src/logic/recorder.ts` - finds the active video and runs each analysis (live stream or recorded sample)
  - `src/logic/streamer.ts` - live session: audio capture, port to the service worker, live results
  - `src/logic/pcm.ts` + `public/pcm-worklet.js` - AudioWorklet capture and 16 kHz PCM conversion
  - `src/logic/videoId.ts` - extracts stable per-platform video IDs
  - `src/background.ts` - service worker; the only part that talks to the backend
  - `src/App.tsx` - toolbar popup: consent and settings
- `Backend/` - Express API
  - `server.js` - routes, security, caching
  - `stream.js` - live-analysis WebSocket: realtime STT relay and incremental analysis scheduler
  - `pipeline.js`, `result.js` - transcript to result, shared by both paths
  - `analysis.js` - transcription and bias analysis
  - `news.js` - related-article lookup
  - `bench/replay.js` - latency benchmark for both paths
  - `test/` - tests (`npm test`)

## Live Analysis

```
content script                 service worker              backend                     ElevenLabs
AudioWorklet -> 16 kHz PCM --> port --------> WebSocket --> /stream session --------> realtime STT
                                                              |  <-- partial / committed text
                                                              +-- incremental Gemini analysis
panel <-- live transcript + provisional score <---------------+
```

- **Capture.** An AudioWorklet taps the video's audio (`captureStream`), downmixes it, and the content script resamples it to 16 kHz 16-bit PCM in 250 ms frames. If a site's CSP blocks the worklet module, a ScriptProcessor fallback is used.
- **Transport.** Frames go through a `chrome.runtime` port to the service worker, which holds the WebSocket. Like every other request, it carries the extension's origin, so the backend can keep rejecting website origins.
- **Scheduler.** The backend analyzes the transcript once it has 8 words, then again after 25 new words, or after 5 s with at least 5 new words. Only one model call is in flight per session; text that arrives during a call triggers one follow-up with the newest transcript.
- **Early stop.** When two consecutive estimates agree (same score, confidence >= 70), the backend tells the extension to stop listening and finalizes. If the transcript hasn't grown since, the last estimate is reused instead of calling the model again. At most 3 provisional calls plus 1 final call are made.
- **Final result.** Related coverage is looked up once, for the final result, and the result is cached by video ID exactly as in the recorded-sample path. If the viewer scrolls away mid-stream, the backend still finishes and caches the result.
- **Fallback.** If the backend has no `/stream` endpoint or can't be reached, the extension switches to recorded samples for the rest of the page session. If one video's audio can't be processed live, that video alone falls back. Live analysis can be turned off in the popup.

## Testing and Benchmarks

```bash
cd Backend && npm test     # stream scheduler, convergence, finalization, WebSocket auth (no API keys needed)
cd Frontend && npm test    # PCM resampler
```

`bench/replay.js` replays audio files through both paths against a running backend and reports p50/p95 time to first estimate and to final result, audio consumed, and model calls per clip:

```bash
cd Backend
npm run bench -- clips/*.mp3 [--url http://localhost:3000] [--key <POLITALK_API_KEY>] [--json results.json]
```

The recorded-sample path is timed as recording time (from the clip length) plus the real upload and analysis round trip. The live path streams at real-time pace and every milestone is timed for real. Decoding uses `ffmpeg`, or `afconvert` on macOS.

## Setup

Prerequisites: Node.js 18+, a [Gemini API key](https://aistudio.google.com/apikey), an [ElevenLabs API key](https://elevenlabs.io), and Chrome.

### 1) Backend

```bash
cd Backend
npm install
cp .env.example .env   # then fill in GEMINI_API_KEY and ELEVENLABS_API_KEY
npm run dev
```

The backend runs on `http://localhost:3000`. See `.env.example` for the optional settings (model, API key, allowed origins, rate limit, cache TTL).

### 2) Extension

```bash
cd Frontend
npm install
npm run build          # or `npm run watch` while developing
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `Frontend/dist`. The welcome page opens automatically; accept the notice to turn PoliTalk on.

### Deploying the backend

If the backend runs anywhere other than your own machine:

1. Set `POLITALK_API_KEY` and enter the same key in the extension's settings.
2. Set `ALLOWED_ORIGINS=chrome-extension://<your-extension-id>`.
3. Enter the server URL in the extension's settings and click **Test connection**.

## API

All endpoints require the `X-PoliTalk-Key` header when `POLITALK_API_KEY` is set.

### `GET /health`

Returns `{ ok, model, requires_key, streaming }`.

### `GET /analysis/:videoId`

Returns a cached result for a video ID such as `tiktok:7351234567890123456`, or `404`.

### `POST /analyze`

Multipart form-data:

- `audio` (file, required) - webm/opus audio sample, max 5 MB
- `video_id` (optional) - cache key, `platform:id`
- `sample_seconds` (optional) - sample length, for display

Returns:

```jsonc
{
  "video_id": "youtube:dQw4w9WgXcQ",
  "analyzed_at": "2026-10-18T12:00:00.000Z",
  "sample_seconds": 20,
  "cached": false,
  "transcription": "...",
  "is_political": true,
  "topic": "Carbon tax repeal",
  "label": "Leans Right",          // Center, Leans Left, Left, Strong Left (and Right equivalents), Not Political, Not Enough Speech
  "overall_score": 2,              // -5..+5
  "economic_score": 3,             // -5..+5 or null
  "social_score": null,
  "framing": "opinion",
  "confidence": 72,                // 0-100
  "reasoning": "...",
  "evidence": [{ "quote": "...", "explanation": "..." }],
  "key_terms": ["carbon tax", "affordability"],
  "related_articles": [{ "title": "...", "url": "https://...", "source": "Reuters" }]
}
```

### `WS /stream`

Live analysis. All messages are JSON text frames.

| Direction | Message |
|---|---|
| client -> server | `{ type: 'start', video_id?, api_key? }` (first message) |
| client -> server | `{ type: 'audio', data }`: base64 PCM, 16-bit little-endian, 16 kHz mono |
| client -> server | `{ type: 'end' }`: no more audio; finalize |
| server -> client | `{ type: 'ready' }` |
| server -> client | `{ type: 'transcript', text }` |
| server -> client | `{ type: 'analysis', version, result }`: provisional result (`provisional: true`, no articles) |
| server -> client | `{ type: 'stop', reason }`: estimate converged or audio limit reached; stop sending |
| server -> client | `{ type: 'final', result, stats }`: same shape as `POST /analyze`, also cached |
| server -> client | `{ type: 'error', error }` |

Sessions are limited to 45 s of audio and 2 minutes. They count against the same per-IP rate limit as `/analyze`.

## Troubleshooting

- **"Can't reach the PoliTalk backend"** - make sure the backend is running and the URL in settings is correct.
- **"The backend's ... API key is missing or invalid"** - check `Backend/.env` and restart the backend.
- **Panel doesn't appear** - check that PoliTalk is on and the site is enabled in the popup, then reload the page. After rebuilding, reload the extension in `chrome://extensions`.
- **"This video's audio can't be captured"** - some videos are DRM-protected or served without CORS and can't be recorded.

## Tech Stack

- Extension: React, TypeScript, Vite, Tailwind, Radix Collapsible, Manifest V3
- Backend: Node.js, Express, `ws`, Multer, Axios, `@google/genai`
- AI services: ElevenLabs Scribe and Scribe Realtime (speech-to-text), Google Gemini (analysis and search grounding)
