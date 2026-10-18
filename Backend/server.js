require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { transcribe, analyzeTranscript, GEMINI_MODEL } = require('./analysis');
const { findRelatedArticles } = require('./news');

const app = express();
const port = Number(process.env.PORT) || 3000;

// Optional shared secret. When set, the extension must send it in X-PoliTalk-Key
// (configured in the extension's settings popup). Set this for any deployed backend.
const API_KEY = process.env.POLITALK_API_KEY || '';

// Comma-separated list of exact origins, e.g. "chrome-extension://abcdefghijklmnop".
// When empty, any chrome-extension:// origin is accepted.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 20;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MIN_WORDS_FOR_ANALYSIS = 8;

if (!process.env.GEMINI_API_KEY) {
    console.error('CRITICAL ERROR: GEMINI_API_KEY not found in environment!');
}
if (!process.env.ELEVENLABS_API_KEY) {
    console.error('CRITICAL ERROR: ELEVENLABS_API_KEY not found in environment! Transcription will fail.');
}

// --- Security ---

function isAllowedOrigin(origin) {
    if (ALLOWED_ORIGINS.length > 0) return ALLOWED_ORIGINS.includes(origin);
    return origin.startsWith('chrome-extension://');
}

// CORS headers alone don't stop a web page from *sending* a request (and spending
// API credits), so requests from website origins are rejected outright.
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
        return res.status(403).json({ error: 'Origin not allowed.' });
    }
    next();
});

app.use(cors({
    origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(origin)),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-PoliTalk-Key'],
}));

function requireApiKey(req, res, next) {
    if (API_KEY && req.get('X-PoliTalk-Key') !== API_KEY) {
        return res.status(401).json({ error: 'Invalid or missing API key.' });
    }
    next();
}

const rateBuckets = new Map();
function rateLimit(req, res, next) {
    const now = Date.now();
    const bucket = rateBuckets.get(req.ip) || { count: 0, resetAt: now + 60000 };
    if (now > bucket.resetAt) {
        bucket.count = 0;
        bucket.resetAt = now + 60000;
    }
    bucket.count++;
    rateBuckets.set(req.ip, bucket);
    if (bucket.count > RATE_LIMIT_PER_MINUTE) {
        res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
        return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    next();
}
setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of rateBuckets) if (now > bucket.resetAt) rateBuckets.delete(ip);
}, 60000).unref();

// Audio stays in memory; nothing is written to disk.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
        const ok = file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm';
        cb(ok ? null : new Error('Only audio uploads are accepted.'), ok);
    },
});

// --- Result cache (keyed by platform video ID) ---

const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_HOURS) || 24) * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;
const cache = new Map();

const isValidVideoId = (id) => typeof id === 'string' && id.length <= 200 && /^[\w:.\-]+$/.test(id);

function cacheGet(id) {
    const entry = cache.get(id);
    if (!entry) return null;
    if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
        cache.delete(id);
        return null;
    }
    return entry.data;
}

function cacheSet(id, data) {
    cache.delete(id);
    cache.set(id, { data, storedAt: Date.now() });
    // Map iterates in insertion order, so the first key is the oldest.
    while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

// --- Routes ---

app.get('/health', (req, res) => {
    res.json({ ok: true, model: GEMINI_MODEL, requires_key: Boolean(API_KEY) });
});

app.get('/analysis/:videoId', requireApiKey, (req, res) => {
    const data = isValidVideoId(req.params.videoId) ? cacheGet(req.params.videoId) : null;
    if (!data) return res.status(404).json({ error: 'Not cached.' });
    res.json({ ...data, cached: true });
});

app.post('/analyze', requireApiKey, rateLimit, upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided.' });
    }

    const videoId = isValidVideoId(req.body.video_id) ? req.body.video_id : null;
    const sampleSeconds = Math.round(Number(req.body.sample_seconds) || 0) || null;
    console.log(`Audio received: ${req.file.size} bytes${videoId ? ` (${videoId})` : ''}`);

    try {
        const transcription = await transcribe(req.file.buffer, req.file.originalname || 'sample.webm', req.file.mimetype);
        const wordCount = transcription.split(/\s+/).filter(Boolean).length;

        let analysis;
        let relatedArticles = [];

        if (wordCount < MIN_WORDS_FOR_ANALYSIS) {
            // Music, silence or a few words: not enough speech to judge.
            analysis = {
                is_political: false,
                topic: '',
                label: 'Not Enough Speech',
                overall_score: 0,
                economic_score: null,
                social_score: null,
                framing: null,
                confidence: 0,
                reasoning: wordCount === 0
                    ? 'No speech was detected in this clip.'
                    : 'Too little speech was detected to assess political content.',
                evidence: [],
                key_terms: [],
            };
        } else {
            analysis = await analyzeTranscript(transcription);
            if (analysis.is_political && analysis.news_query) {
                try {
                    relatedArticles = await findRelatedArticles(analysis.news_query, analysis.topic);
                } catch (e) {
                    // Articles are supplementary; never fail the whole analysis over them.
                    console.warn('Related article lookup failed:', e.message);
                }
            }
        }

        const { news_query, ...publicAnalysis } = analysis;
        const result = {
            video_id: videoId,
            analyzed_at: new Date().toISOString(),
            sample_seconds: sampleSeconds,
            transcription,
            ...publicAnalysis,
            related_articles: relatedArticles,
        };

        if (videoId) cacheSet(videoId, result);
        console.log(`Analysis complete: ${result.label} (${relatedArticles.length} articles)`);
        res.json({ ...result, cached: false });
    } catch (error) {
        const upstreamStatus = error.response?.status;
        console.error('Processing error:', upstreamStatus || '', error.response?.data ? JSON.stringify(error.response.data) : error.message);

        let message = 'Analysis failed. Check the backend logs for details.';
        if (upstreamStatus === 401 || upstreamStatus === 403) message = 'The backend\'s transcription API key was rejected.';
        else if (upstreamStatus === 429) message = 'An upstream API rate limit was hit. Try again shortly.';
        else if (/API key/i.test(error.message)) message = 'The backend\'s Gemini API key is missing or invalid.';

        res.status(502).json({ error: message });
    }
});

// Multer and other middleware errors (e.g. file too large) end up here.
app.use((err, req, res, next) => {
    const status = err instanceof multer.MulterError ? 413 : 400;
    res.status(status).json({ error: err.message });
});

app.listen(port, () => {
    console.log(`PoliTalk backend running at http://localhost:${port} (model: ${GEMINI_MODEL})`);
});
