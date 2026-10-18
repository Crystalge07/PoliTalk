require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { transcribe, analyzeTranscript, GEMINI_MODEL } = require('./analysis');
const { analyzeFinal } = require('./pipeline');
const { publicErrorMessage } = require('./result');
const { attachStreamServer } = require('./stream');

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

const checkApiKey = (key) => !API_KEY || key === API_KEY;

function requireApiKey(req, res, next) {
    if (!checkApiKey(req.get('X-PoliTalk-Key'))) {
        return res.status(401).json({ error: 'Invalid or missing API key.' });
    }
    next();
}

const rateBuckets = new Map();
/** Counts one request against `ip`. Returns 0 if allowed, otherwise seconds until the limit resets. */
function takeRateToken(ip) {
    const now = Date.now();
    const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + 60000 };
    if (now > bucket.resetAt) {
        bucket.count = 0;
        bucket.resetAt = now + 60000;
    }
    bucket.count++;
    rateBuckets.set(ip, bucket);
    return bucket.count > RATE_LIMIT_PER_MINUTE ? Math.ceil((bucket.resetAt - now) / 1000) : 0;
}

function rateLimit(req, res, next) {
    const retryAfter = takeRateToken(req.ip);
    if (retryAfter) {
        res.set('Retry-After', String(retryAfter));
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
    res.json({ ok: true, model: GEMINI_MODEL, requires_key: Boolean(API_KEY), streaming: true });
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
        const started = Date.now();
        const transcription = await transcribe(req.file.buffer, req.file.originalname || 'sample.webm', req.file.mimetype);
        const sttMs = Date.now() - started;
        const { result, timings } = await analyzeFinal(transcription, { videoId, sampleSeconds });

        if (videoId) cacheSet(videoId, result);
        console.log('batch analysis', JSON.stringify({
            video_id: videoId,
            label: result.label,
            articles: result.related_articles.length,
            stt_ms: sttMs,
            ...timings,
            total_ms: Date.now() - started,
        }));
        res.json({ ...result, cached: false });
    } catch (error) {
        console.error('Processing error:', error.response?.status || '', error.response?.data ? JSON.stringify(error.response.data) : error.message);
        res.status(502).json({ error: publicErrorMessage(error) });
    }
});

// Multer and other middleware errors (e.g. file too large) end up here.
app.use((err, req, res, next) => {
    const status = err instanceof multer.MulterError ? 413 : 400;
    res.status(status).json({ error: err.message });
});

const server = app.listen(port, () => {
    console.log(`PoliTalk backend running at http://localhost:${port} (model: ${GEMINI_MODEL})`);
});

attachStreamServer(server, {
    isAllowedOrigin,
    checkApiKey,
    takeRateToken,
    isValidVideoId,
    analyze: analyzeTranscript,
    finalize: async (text, opts) => {
        const { result } = await analyzeFinal(text, opts);
        if (opts.videoId) cacheSet(opts.videoId, result);
        return { ...result, cached: false };
    },
});
