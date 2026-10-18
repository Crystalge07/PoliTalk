const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { StreamSession, attachStreamServer } = require('../stream');

const words = (n, offset = 0) => Array.from({ length: n }, (_, i) => `w${i + offset}`).join(' ');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeTranscriber() {
    return {
        handlers: null,
        audio: [],
        flushed: false,
        closed: false,
        start(h) { this.handlers = h; },
        sendAudio(b64) { this.audio.push(b64); },
        flush() { this.flushed = true; return Promise.resolve(); },
        close() { this.closed = true; },
    };
}

function analysisOf(score, confidence = 90) {
    return {
        is_political: true, topic: 't', label: 'x', overall_score: score, economic_score: null, social_score: null,
        framing: 'opinion', confidence, reasoning: '', evidence: [], key_terms: [], news_query: '',
    };
}

/** An analyze() whose calls resolve only when the test says so. */
function controllableAnalyze() {
    const calls = [];
    const analyze = (text) => new Promise((resolve, reject) => calls.push({ text, resolve, reject }));
    return { analyze, calls };
}

function makeSession(overrides = {}) {
    const sent = [];
    const transcriber = fakeTranscriber();
    const finalizeCalls = [];
    let clock = 0;
    const session = new StreamSession({
        videoId: 'youtube:abc',
        send: (m) => sent.push(m),
        transcriber,
        analyze: async () => analysisOf(2),
        finalize: async (text, opts) => {
            finalizeCalls.push({ text, ...opts });
            return { transcription: text, final: true };
        },
        now: () => clock,
        ...overrides,
    });
    session.start();
    return { session, sent, transcriber, finalizeCalls, advance: (ms) => { clock += ms; } };
}

test('does not analyze until there are enough words', async () => {
    const { analyze, calls } = controllableAnalyze();
    const { session, transcriber } = makeSession({ analyze });
    transcriber.handlers.onPartial(words(7));
    assert.equal(calls.length, 0);
    transcriber.handlers.onPartial(words(8));
    assert.equal(calls.length, 1);
    session.close();
});

test('keeps one model call in flight and re-runs once with the newest text', async () => {
    const { analyze, calls } = controllableAnalyze();
    const { session, transcriber, sent } = makeSession({ analyze });

    transcriber.handlers.onCommitted(words(10));
    transcriber.handlers.onCommitted(words(30, 10));
    transcriber.handlers.onCommitted(words(30, 40));
    assert.equal(calls.length, 1, 'no second call while the first is in flight');

    calls[0].resolve(analysisOf(-2, 40));
    await tick();
    assert.equal(calls.length, 2, 'dirty session re-runs after the call returns');
    assert.equal(calls[1].text.split(' ').length, 70, 're-run sees the full transcript');
    assert.deepEqual(sent.filter((m) => m.type === 'analysis').map((m) => m.version), [1]);
    session.close();
});

test('re-analyzes on elapsed time once a few new words arrive', async () => {
    const { analyze, calls } = controllableAnalyze();
    const { session, transcriber, advance } = makeSession({ analyze });
    transcriber.handlers.onPartial(words(10));
    calls[0].resolve(analysisOf(1, 40));
    await tick();

    transcriber.handlers.onPartial(words(16));
    assert.equal(calls.length, 1, 'too soon and too few words');
    advance(5000);
    transcriber.handlers.onPartial(words(16));
    assert.equal(calls.length, 2);
    session.close();
});

test('two agreeing confident results stop the session and the final pass reuses the last analysis', async () => {
    const { analyze, calls } = controllableAnalyze();
    const { session, transcriber, sent, finalizeCalls } = makeSession({ analyze });

    transcriber.handlers.onCommitted(words(10));
    calls[0].resolve(analysisOf(3, 80));
    await tick();
    transcriber.handlers.onCommitted(words(25, 10));
    calls[1].resolve(analysisOf(3, 85));
    await session.done;

    const types = sent.map((m) => m.type);
    assert.ok(types.indexOf('stop') < types.indexOf('final'));
    assert.equal(sent.find((m) => m.type === 'stop').reason, 'converged');
    assert.equal(finalizeCalls.length, 1);
    assert.equal(finalizeCalls[0].prior.overall_score, 3, 'final reuses the converged analysis');
    assert.equal(calls.length, 2, 'no extra model call');
    assert.ok(transcriber.closed);
});

test('disagreeing or low-confidence results do not converge', async () => {
    const { analyze, calls } = controllableAnalyze();
    const { session, transcriber, sent } = makeSession({ analyze });
    transcriber.handlers.onCommitted(words(10));
    calls[0].resolve(analysisOf(3, 50));
    await tick();
    transcriber.handlers.onCommitted(words(25, 10));
    calls[1].resolve(analysisOf(3, 50));
    await tick();
    assert.ok(!sent.some((m) => m.type === 'stop'));
    session.close();
});

test('caps the number of provisional analyses', async () => {
    let n = 0;
    const { session, transcriber } = makeSession({ analyze: async () => analysisOf(n++ % 2 ? 2 : -2) });
    for (let i = 0; i < 10; i++) {
        transcriber.handlers.onCommitted(words(30, i * 30));
        await tick();
    }
    assert.equal(n, 3);
    session.close();
});

test('end of audio flushes the transcriber and re-analyzes new speech in the final pass', async () => {
    const { session, transcriber, finalizeCalls, sent } = makeSession();
    transcriber.handlers.onCommitted(words(10));
    await tick();
    transcriber.handlers.onPartial(words(20, 10));
    await session.finish('client_end');

    assert.ok(transcriber.flushed, 'in-progress segment is committed before finalizing');
    assert.equal(finalizeCalls[0].prior, null, 'transcript grew too much to reuse');
    assert.equal(sent.at(-1).type, 'final');
});

test('transcriber failure with no speech reports an error', async () => {
    const { session, transcriber, sent, finalizeCalls } = makeSession();
    transcriber.handlers.onError(Object.assign(new Error('nope'), { response: { status: 401 } }));
    await session.done;
    assert.equal(sent.at(-1).type, 'error');
    assert.match(sent.at(-1).error, /API key/);
    assert.equal(finalizeCalls.length, 0);
});

test('transcriber failure after speech still produces a final result', async () => {
    const { session, transcriber, sent } = makeSession();
    transcriber.handlers.onCommitted(words(12));
    transcriber.handlers.onError(new Error('dropped'));
    await session.done;
    assert.equal(sent.at(-1).type, 'final');
});

test('counts audio seconds and stops at the audio limit', async () => {
    const { session, sent } = makeSession();
    const oneSecond = Buffer.alloc(32000).toString('base64');
    session.audio(oneSecond);
    assert.equal(session.sampleSeconds, 1);
    for (let i = 0; i < 50; i++) session.audio(oneSecond);
    await session.done;
    assert.equal(sent.find((m) => m.type === 'stop').reason, 'max_audio');
    assert.equal(session.sampleSeconds, 45);
});

// --- Over a real WebSocket ---

function startServer(depsOverrides = {}) {
    const transcribers = [];
    const finalized = [];
    const server = http.createServer();
    attachStreamServer(server, {
        isAllowedOrigin: (o) => o.startsWith('chrome-extension://'),
        checkApiKey: (k) => k === 'secret',
        takeRateToken: () => 0,
        isValidVideoId: (id) => typeof id === 'string',
        analyze: async () => analysisOf(-4, 95),
        finalize: async (text, opts) => {
            finalized.push({ text, ...opts });
            return { transcription: text, video_id: opts.videoId };
        },
        ...depsOverrides,
    }, {
        createTranscriber: () => {
            const t = fakeTranscriber();
            t.sendAudio = function () {
                // Every audio chunk "transcribes" to ten more words.
                this.handlers.onCommitted(words(10, this.audio.push(1) * 10));
            };
            transcribers.push(t);
            return t;
        },
    });
    return new Promise((resolve) => server.listen(0, () => resolve({
        server, transcribers, finalized, url: `ws://localhost:${server.address().port}/stream`,
    })));
}

function collect(ws) {
    const messages = [];
    ws.on('message', (d) => messages.push(JSON.parse(d)));
    const closed = new Promise((resolve) => ws.on('close', () => resolve(messages)));
    return { messages, closed };
}

test('streams audio end to end and converges to a cached final result', async () => {
    const { server, finalized, url } = await startServer();
    const ws = new WebSocket(url);
    const { closed } = collect(ws);
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'start', video_id: 'tiktok:123', api_key: 'secret' }));
    for (let i = 0; i < 4; i++) {
        ws.send(JSON.stringify({ type: 'audio', data: Buffer.alloc(8000).toString('base64') }));
        await new Promise((r) => setTimeout(r, 20));
    }
    const messages = await closed;
    const types = messages.map((m) => m.type);

    assert.equal(types[0], 'ready');
    assert.ok(types.includes('transcript'));
    assert.ok(types.includes('analysis'));
    assert.equal(messages.find((m) => m.type === 'analysis').result.provisional, true);
    assert.equal(types.at(-1), 'final');
    assert.equal(finalized[0].videoId, 'tiktok:123');
    assert.ok(finalized[0].prior, 'converged analysis reused');
    server.close();
});

test('rejects a bad API key and website origins', async () => {
    const { server, url } = await startServer();

    const ws = new WebSocket(url);
    const { closed } = collect(ws);
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'start', api_key: 'wrong' }));
    const messages = await closed;
    assert.deepEqual(messages.map((m) => m.type), ['error']);

    const fromWebsite = new WebSocket(url, { origin: 'https://evil.example' });
    const status = await new Promise((r) => fromWebsite.on('unexpected-response', (_req, res) => r(res.statusCode)));
    assert.equal(status, 401);
    server.close();
});

test('a client that disconnects mid-stream still gets its result cached', async () => {
    const { server, finalized, url } = await startServer({ analyze: async () => analysisOf(1, 10) });
    const ws = new WebSocket(url);
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'start', video_id: 'youtube:x', api_key: 'secret' }));
    ws.send(JSON.stringify({ type: 'audio', data: 'AAAA' }));
    await new Promise((r) => setTimeout(r, 30));
    ws.terminate();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(finalized.length, 1);
    assert.equal(finalized[0].videoId, 'youtube:x');
    server.close();
});
