# PoliTalk

PoliTalk is a browser extension that analyzes short-form videos for political bias in near real-time.
It records the currently playing video on supported platforms, transcribes speech, estimates a bias score, and surfaces related news links for context.

Project page: [Devpost submission](https://devpost.com/software/politalk-6digfl)

## What It Does

- Detects active videos on TikTok, Instagram, and YouTube.
- Captures a short recording from the visible playing video.
- Sends the clip to a local backend for analysis.
- Transcribes speech using ElevenLabs Speech-to-Text.
- Scores political bias (1-10) and labels direction/strength via Gemini.
- Shows key terms, transcript text, and related news articles in an on-page UI.

## Repo Structure

- `Frontend/` - Chrome extension (Vite + React + TypeScript + Tailwind).
- `Backend/` - Express API that handles upload, transcription, and AI analysis.
- `README.md` - Project documentation (this file).

## Prerequisites

- Node.js 18+ (recommended: latest LTS)
- npm
- Google Gemini API key
- ElevenLabs API key
- Chrome (or Chromium-based browser) for loading the extension

## Environment Variables

Create a `.env` file in `Backend/`:

```env
GEMINI_API_KEY=your_gemini_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
```

Notes:
- `GEMINI_API_KEY` is required for bias analysis.
- `ELEVENLABS_API_KEY` is required for transcription.

## Installation

Install backend dependencies:

```bash
cd Backend
npm install
```

Install frontend dependencies:

```bash
cd Frontend
npm install
```

## Run Locally

### 1) Start backend API

From `Backend/`:

```bash
npm run dev
```

Backend runs on `http://localhost:3000`.

### 2) Build frontend extension

From `Frontend/`:

```bash
npm run build
```

This outputs the extension bundle in `Frontend/dist/`.

### 3) Load extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `Frontend/dist`

## Usage

1. Make sure the backend is running.
2. Open TikTok, Instagram, or YouTube.
3. Play a video.
4. PoliTalk injects a panel in the page and starts analysis automatically.
5. Review:
   - Bias spectrum and label
   - Key terms
   - Transcript
   - Related news links (if available)

## API

### `POST /analyze`

Accepts multipart form-data with:
- `video` (file, expected as webm from the extension recorder)

Returns JSON including:
- `bias_score`
- `bias_label`
- `key_terms`
- `transcription`
- `related_articles`

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind, Radix UI
- Extension: Manifest V3 content script + injected UI
- Backend: Node.js, Express, Multer, Axios
- AI Services: ElevenLabs STT + Google Gemini

## Troubleshooting

- `Failed to fetch` in the extension UI:
  - Confirm backend is running on `http://localhost:3000`
- Analysis errors:
  - Verify both API keys are set in `Backend/.env`
  - Restart backend after changing env vars
- No results on page:
  - Ensure you are on a supported domain with an actively playing video
  - Rebuild and reload the extension after frontend changes

## Scripts

Backend (`Backend/package.json`):
- `npm run start` - run backend with Node
- `npm run dev` - run backend with nodemon

Frontend (`Frontend/package.json`):
- `npm run dev` - run Vite dev server
- `npm run build` - build extension assets
- `npm run preview` - preview built frontend
- `npm run lint` - run ESLint
