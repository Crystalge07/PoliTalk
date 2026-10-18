// Live analysis over WebSocket. The extension streams 16 kHz PCM; the backend relays
// it to a realtime speech-to-text service and re-analyzes the transcript as it grows,
// pushing provisional results until the estimate converges or the audio ends.
//
// Client -> server (JSON text frames):
//   { type: 'start', video_id?, api_key? }   must be the first message
//   { type: 'audio', data: <base64 pcm_s16le, 16 kHz mono> }
//   { type: 'end' }                          no more audio; finalize with what was heard
// Server -> client:
//   { type: 'ready' }
//   { type: 'transcript', text }             committed + in-progress text so far
//   { type: 'analysis', version, result }    provisional result (no related articles)
//   { type: 'stop', reason }                 enough audio received; stop sending
//   { type: 'final', result, stats }         full result (also cached) and model-call stats
//   { type: 'error', error }
const WebSocket = require('ws');
const { MIN_WORDS_FOR_ANALYSIS, countWords, toResult, publicErrorMessage } = require('./result');

const SAMPLE_RATE = 16000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
const MAX_AUDIO_SECONDS = 45;
const SESSION_TIMEOUT_MS = 120_000;
const START_TIMEOUT_MS = 5_000;
const MAX_CONCURRENT_SESSIONS = Number(process.env.MAX_STREAM_SESSIONS) || 50;

// Scheduler: when to spend a model call on a growing transcript.
const REANALYZE_AFTER_WORDS = 25;
const REANALYZE_AFTER_MS = 5_000;
const MIN_NEW_WORDS = 5;
const MAX_PROVISIONAL_ANALYSES = 3;
// Two consecutive results that agree at this confidence end the session early.
const CONVERGED_CONFIDENCE = 70;
// A final transcript at most this many words longer than the last analyzed one reuses that analysis.
const REUSE_WITHIN_WORDS = 3;
const FLUSH_TIMEOUT_MS = 2_500;

const ELEVENLABS_REALTIME_MODEL = process.env.ELEVENLABS_REALTIME_MODEL || 'scribe_v2_realtime';

/**
 * Relays audio to ElevenLabs realtime STT. Committed segments arrive at pauses in
 * speech (VAD); partials cover the segment currently being spoken.
 */
function createElevenLabsTranscriber() {
    let ws;
    let handlers;
    let queue = [];
    let closing = false;
    let onCommit = null;

    const chunk = (base64, commit) => JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: base64,
        commit,
        sample_rate: SAMPLE_RATE,
    });
    const send = (message) => (ws.readyState === WebSocket.OPEN ? ws.send(message) : queue.push(message));

    const fail = (error) => {
        if (closing) return;
        closing = true;
        ws.terminate();
        handlers.onError(error);
    };

    return {
        start(h) {
            handlers = h;
            const params = new URLSearchParams({
                model_id: ELEVENLABS_REALTIME_MODEL,
                audio_format: 'pcm_16000',
                commit_strategy: 'vad',
            });
            ws = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`, {
                headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
            });
            ws.on('open', () => {
                queue.forEach((m) => ws.send(m));
                queue = [];
            });
            ws.on('message', (data) => {
                let msg;
                try {
                    msg = JSON.parse(data.toString());
                } catch {
                    return;
                }
                if (msg.message_type === 'partial_transcript') handlers.onPartial(msg.text || '');
                else if (msg.message_type === 'committed_transcript') {
                    handlers.onCommitted(msg.text || '');
                    onCommit?.();
                } else if (msg.error) {
                    const status = msg.message_type === 'auth_error' ? 401
                        : /quota|rate_limited|throttled/.test(msg.message_type) ? 429 : undefined;
                    fail(Object.assign(new Error(`ElevenLabs ${msg.message_type}: ${msg.error}`), status && { response: { status } }));
                }
            });
            ws.on('error', (e) => {
                const status = Number(/Unexpected server response: (\d+)/.exec(e.message)?.[1]);
                fail(Object.assign(e, status && { response: { status } }));
            });
            ws.on('close', (code) => fail(new Error(`ElevenLabs connection closed (${code})`)));
        },
        sendAudio(base64) {
            if (!closing) send(chunk(base64, false));
        },
        /** Forces the in-progress segment to be committed; resolves once it arrives (or on timeout). */
        flush() {
            if (closing) return Promise.resolve();
            return new Promise((resolve) => {
                const timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
                onCommit = () => {
                    clearTimeout(timer);
                    resolve();
                };
                // 100 ms of silence carries the commit flag.
                send(chunk(Buffer.alloc(BYTES_PER_SECOND / 10).toString('base64'), true));
            });
        },
        close() {
            closing = true;
            if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
            else ws.close();
        },
    };
}

/**
 * One streamed video. Owns the transcript and decides when to analyze it.
 * Dependencies are injected so the scheduling logic can be tested without network calls.
 */
class StreamSession {
    constructor({ videoId = null, send, transcriber, analyze, finalize, log = () => {}, now = Date.now }) {
        Object.assign(this, { videoId, send, transcriber, analyze, finalize, log, now });
        this.state = 'open'; // open -> finalizing -> closed
        this.committed = '';
        this.partial = '';
        this.audioBytes = 0;
        this.analyses = []; // { text, words, analysis }
        this.inFlight = null;
        this.dirty = false;
        this.lastAnalyzedWords = 0;
        this.lastAnalyzedAt = 0;
        this.version = 0;
        this.startedAt = now();
        this.marks = {};
        this.done = new Promise((resolve) => { this.resolveDone = resolve; });
    }

    get text() {
        return [this.committed, this.partial].filter(Boolean).join(' ').trim();
    }

    get sampleSeconds() {
        return Math.round(this.audioBytes / BYTES_PER_SECOND);
    }

    mark(name) {
        if (!(name in this.marks)) this.marks[name] = this.now() - this.startedAt;
    }

    start() {
        this.timeout = setTimeout(() => this.finish('timeout'), SESSION_TIMEOUT_MS);
        this.transcriber.start({
            onPartial: (text) => this.onTranscript(() => { this.partial = text.trim(); }),
            onCommitted: (text) => this.onTranscript(() => {
                this.committed = [this.committed, text.trim()].filter(Boolean).join(' ');
                this.partial = '';
            }),
            onError: (error) => this.onTranscriberError(error),
        });
    }

    audio(base64) {
        if (this.state !== 'open') return;
        this.mark('first_audio');
        this.audioBytes += Math.floor((base64.length * 3) / 4);
        this.transcriber.sendAudio(base64);
        if (this.audioBytes >= MAX_AUDIO_SECONDS * BYTES_PER_SECOND) this.finish('max_audio');
    }

    onTranscript(update) {
        if (this.state === 'closed') return;
        update();
        if (!this.text) return;
        this.mark('first_transcript');
        if (this.state === 'open') {
            this.send({ type: 'transcript', text: this.text });
            this.maybeAnalyze();
        }
    }

    onTranscriberError(error) {
        this.log('stream transcriber error', error.message);
        if (this.state !== 'open') return;
        if (this.text) {
            // Keep what was heard rather than throwing it away.
            this.finish('transcriber_error');
        } else {
            this.send({ type: 'error', error: publicErrorMessage(error) });
            this.close();
        }
    }

    maybeAnalyze() {
        if (this.state !== 'open' || this.analyses.length >= MAX_PROVISIONAL_ANALYSES) return;
        if (this.inFlight) {
            this.dirty = true;
            return;
        }
        const text = this.text;
        const words = countWords(text);
        if (words < MIN_WORDS_FOR_ANALYSIS) return;

        const newWords = words - this.lastAnalyzedWords;
        const due = this.lastAnalyzedWords === 0
            || newWords >= REANALYZE_AFTER_WORDS
            || (newWords >= MIN_NEW_WORDS && this.now() - this.lastAnalyzedAt >= REANALYZE_AFTER_MS);
        if (due) this.runProvisional(text, words);
    }

    async runProvisional(text, words) {
        this.lastAnalyzedWords = words;
        this.lastAnalyzedAt = this.now();
        const version = ++this.version;

        let analysis;
        this.inFlight = this.analyze(text);
        try {
            analysis = await this.inFlight;
        } catch (e) {
            // A failed provisional pass is not fatal; the final pass will try again.
            this.log('provisional analysis failed', e.message);
            return;
        } finally {
            this.inFlight = null;
        }

        this.analyses.push({ text, words, analysis });
        if (this.state !== 'open') return;

        this.mark('first_analysis');
        const result = toResult({ videoId: this.videoId, sampleSeconds: this.sampleSeconds, transcription: text, analysis, provisional: true });
        this.send({ type: 'analysis', version, result });

        if (this.converged()) {
            this.finish('converged');
        } else if (this.dirty) {
            this.dirty = false;
            this.maybeAnalyze();
        }
    }

    converged() {
        const [a, b] = this.analyses.slice(-2).map((x) => x.analysis);
        return Boolean(a && b)
            && a.is_political === b.is_political
            && a.overall_score === b.overall_score
            && Math.min(a.confidence, b.confidence) >= CONVERGED_CONFIDENCE;
    }

    async finish(reason) {
        if (this.state !== 'open') return;
        this.state = 'finalizing';
        clearTimeout(this.timeout);
        this.send({ type: 'stop', reason });

        if (this.partial) await this.transcriber.flush();
        this.transcriber.close();
        if (this.inFlight) await this.inFlight.catch(() => {});

        const text = this.text;
        const last = this.analyses.at(-1);
        const prior = last && countWords(text) - last.words <= REUSE_WITHIN_WORDS ? last.analysis : null;
        const finalNeedsModel = !prior && countWords(text) >= MIN_WORDS_FOR_ANALYSIS;
        const stats = { model_calls: this.version + (finalNeedsModel ? 1 : 0), reused_provisional: Boolean(prior), reason };

        try {
            const result = await this.finalize(text, { prior, sampleSeconds: this.sampleSeconds });
            this.mark('final');
            this.send({ type: 'final', result, stats });
        } catch (e) {
            this.log('stream finalize failed', e.message);
            this.send({ type: 'error', error: publicErrorMessage(e) });
        }

        this.log('stream session', JSON.stringify({
            video_id: this.videoId,
            audio_seconds: this.sampleSeconds,
            words: countWords(text),
            ...stats,
            ...this.marks,
        }));
        this.close();
    }

    /** The client went away. Finish anyway when there is speech, so the result is cached for next time. */
    abandon() {
        this.send = () => {};
        if (this.state === 'open' && countWords(this.text) >= MIN_WORDS_FOR_ANALYSIS) this.finish('client_gone');
        else if (this.state === 'open') this.close();
    }

    close() {
        if (this.state === 'closed') return;
        this.state = 'closed';
        clearTimeout(this.timeout);
        this.transcriber.close();
        this.resolveDone();
    }
}

/**
 * Accepts streaming sessions on `path`. `deps` supplies the server's security checks,
 * cache, and analysis functions so this module stays free of HTTP concerns.
 */
function attachStreamServer(httpServer, deps, { path = '/stream', createTranscriber = createElevenLabsTranscriber } = {}) {
    const wss = new WebSocket.WebSocketServer({
        server: httpServer,
        path,
        maxPayload: 256 * 1024,
        // Same rule as HTTP: website origins are rejected, extension and non-browser clients allowed.
        verifyClient: ({ origin }) => !origin || deps.isAllowedOrigin(origin),
    });
    let active = 0;

    wss.on('connection', (ws, req) => {
        const send = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
        const reject = (error) => {
            send({ type: 'error', error });
            ws.close(1008);
        };
        let session = null;
        const startTimer = setTimeout(() => reject('No start message received.'), START_TIMEOUT_MS);

        ws.on('message', (data, isBinary) => {
            let msg;
            try {
                msg = isBinary ? null : JSON.parse(data.toString());
            } catch {
                msg = null;
            }
            if (!msg || typeof msg.type !== 'string') return reject('Malformed message.');

            if (!session) {
                if (msg.type !== 'start') return reject('Expected a start message.');
                clearTimeout(startTimer);
                if (!deps.checkApiKey(msg.api_key)) return reject('Invalid or missing API key.');
                const retryAfter = deps.takeRateToken(req.socket.remoteAddress);
                if (retryAfter) return reject('Too many requests. Please slow down.');
                if (active >= MAX_CONCURRENT_SESSIONS) return reject('The server is busy. Try again shortly.');

                const videoId = deps.isValidVideoId(msg.video_id) ? msg.video_id : null;
                active++;
                session = new StreamSession({
                    videoId,
                    send,
                    transcriber: createTranscriber(),
                    analyze: deps.analyze,
                    finalize: (text, opts) => deps.finalize(text, { ...opts, videoId }),
                    log: console.log,
                });
                session.done.then(() => {
                    active--;
                    ws.close(1000);
                });
                session.start();
                send({ type: 'ready' });
                return;
            }

            if (msg.type === 'audio' && typeof msg.data === 'string') session.audio(msg.data);
            else if (msg.type === 'end') session.finish('client_end');
            else reject('Unknown message type.');
        });

        ws.on('close', () => {
            clearTimeout(startTimer);
            session?.abandon();
        });
        ws.on('error', () => {});
    });

    return wss;
}

module.exports = { attachStreamServer, StreamSession, createElevenLabsTranscriber, SAMPLE_RATE };
