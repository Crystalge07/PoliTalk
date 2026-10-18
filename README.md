# PoliTalk

PoliTalk is a Chrome extension that estimates the political lean of short-form videos on TikTok, Instagram and YouTube, and shows the evidence behind each score.

Project page: [Devpost submission](https://devpost.com/software/politalk-6digfl)

## What It Does

- Detects the video you're watching on TikTok, Instagram, YouTube Shorts and YouTube watch pages (ads and hover previews are skipped).
- Records a **~20 second audio-only sample** (never video) while it plays.
- Transcribes speech with ElevenLabs Speech-to-Text.
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
  - `src/logic/recorder.ts` - finds the active video and records audio samples
  - `src/logic/videoId.ts` - extracts stable per-platform video IDs
  - `src/background.ts` - service worker; the only part that talks to the backend
  - `src/App.tsx` - toolbar popup: consent and settings
- `Backend/` - Express API
  - `server.js` - routes, security, caching
  - `analysis.js` - transcription and bias analysis
  - `news.js` - related-article lookup

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

Returns `{ ok, model, requires_key }`.

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

## Troubleshooting

- **"Can't reach the PoliTalk backend"** - make sure the backend is running and the URL in settings is correct.
- **"The backend's ... API key is missing or invalid"** - check `Backend/.env` and restart the backend.
- **Panel doesn't appear** - check that PoliTalk is on and the site is enabled in the popup, then reload the page. After rebuilding, reload the extension in `chrome://extensions`.
- **"This video's audio can't be captured"** - some videos are DRM-protected or served without CORS and can't be recorded.

## Tech Stack

- Extension: React, TypeScript, Vite, Tailwind, Radix Collapsible, Manifest V3
- Backend: Node.js, Express, Multer, Axios, `@google/genai`
- AI services: ElevenLabs Scribe (speech-to-text), Google Gemini (analysis and search grounding)
