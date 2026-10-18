#!/usr/bin/env node
// Replays audio files through both analysis paths against a running backend and
// reports latency percentiles.
//
//   node bench/replay.js clips/*.mp3 [--url http://localhost:3000] [--key <POLITALK_API_KEY>]
//                        [--only batch|stream] [--json results.json]
//
// Timing matches what a viewer experiences once analysis starts (the extension's
// 1.5 s auto-start delay applies to both paths and is excluded):
// - batch: the extension records a 20 s sample before uploading. Recording time is
//   added from the clip length rather than waited out; the upload is timed for real.
// - stream: audio is sent in 250 ms frames at real-time pace, exactly as the
//   extension would, and every milestone is timed for real.
//
// Inputs can be any format ffmpeg (or macOS afconvert) can decode.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const WebSocket = require('ws');

const SAMPLE_RATE = 16000;
const BATCH_SAMPLE_SECONDS = 20;
const STREAM_MAX_SECONDS = 30;
const FRAME_MS = 250;

function parseArgs(argv) {
    const opts = { files: [], url: 'http://localhost:3000', key: process.env.POLITALK_API_KEY || '', only: null, json: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--url') opts.url = argv[++i];
        else if (a === '--key') opts.key = argv[++i];
        else if (a === '--only') opts.only = argv[++i];
        else if (a === '--json') opts.json = argv[++i];
        else opts.files.push(a);
    }
    return opts;
}

/** Decodes any audio file to 16 kHz mono 16-bit PCM. */
function decodeToPcm(file) {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'politalk-bench-')), 'audio.wav');
    const ffmpeg = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-sample_fmt', 's16', out]);
    if (ffmpeg.error || ffmpeg.status !== 0) {
        const afconvert = spawnSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${SAMPLE_RATE}`, '-c', '1', file, out]);
        if (afconvert.error || afconvert.status !== 0) {
            throw new Error(`Can't decode ${file}: install ffmpeg (or run on macOS for afconvert).`);
        }
    }
    const pcm = readWavData(fs.readFileSync(out));
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
    return pcm;
}

function readWavData(buf) {
    let offset = 12;
    while (offset + 8 <= buf.length) {
        const id = buf.toString('ascii', offset, offset + 4);
        const size = buf.readUInt32LE(offset + 4);
        if (id === 'data') return buf.subarray(offset + 8, offset + 8 + size);
        offset += 8 + size + (size % 2);
    }
    throw new Error('No data chunk in WAV');
}

function wavFromPcm(pcm) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

const secondsOf = (pcm) => pcm.length / (SAMPLE_RATE * 2);

async function runBatch(pcm, opts) {
    const sample = pcm.subarray(0, BATCH_SAMPLE_SECONDS * SAMPLE_RATE * 2);
    const recordMs = Math.round(secondsOf(sample) * 1000);
    const form = new FormData();
    form.append('audio', new Blob([wavFromPcm(sample)], { type: 'audio/wav' }), 'sample.wav');
    form.append('sample_seconds', String(Math.round(secondsOf(sample))));

    const started = performance.now();
    const response = await fetch(`${opts.url}/analyze`, {
        method: 'POST',
        body: form,
        headers: opts.key ? { 'X-PoliTalk-Key': opts.key } : {},
    });
    const body = await response.json();
    const requestMs = Math.round(performance.now() - started);
    if (!response.ok) throw new Error(`batch: ${response.status} ${body.error}`);
    return {
        first_estimate_ms: recordMs + requestMs,
        final_ms: recordMs + requestMs,
        audio_seconds: Math.round(secondsOf(sample)),
        model_calls: body.label === 'Not Enough Speech' ? 0 : 1,
        label: body.label,
        score: body.overall_score,
    };
}

function runStream(pcm, opts) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${opts.url.replace(/^http/, 'ws')}/stream`);
        const started = performance.now();
        const elapsed = () => Math.round(performance.now() - started);
        const marks = {};
        const mark = (name) => { marks[name] ??= elapsed(); };
        const frameBytes = (SAMPLE_RATE * 2 * FRAME_MS) / 1000;
        const limit = Math.min(pcm.length, STREAM_MAX_SECONDS * SAMPLE_RATE * 2);
        let offset = 0;
        let timer = null;
        let analyses = 0; // fallback count if the server sends no stats

        const sendFrame = () => {
            if (offset >= limit) {
                clearInterval(timer);
                ws.send(JSON.stringify({ type: 'end' }));
                return;
            }
            ws.send(JSON.stringify({ type: 'audio', data: pcm.subarray(offset, offset + frameBytes).toString('base64') }));
            offset += frameBytes;
        };

        ws.on('open', () => {
            ws.send(JSON.stringify({ type: 'start', api_key: opts.key }));
            sendFrame();
            timer = setInterval(sendFrame, FRAME_MS);
        });
        ws.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.type === 'transcript') mark('first_transcript_ms');
            if (msg.type === 'analysis') {
                analyses++;
                mark('first_estimate_ms');
            }
            if (msg.type === 'stop') {
                clearInterval(timer);
                mark('stop_ms');
            }
            if (msg.type === 'error') {
                clearInterval(timer);
                reject(new Error(`stream: ${msg.error}`));
                ws.close();
            }
            if (msg.type === 'final') {
                clearInterval(timer);
                mark('first_estimate_ms');
                resolve({
                    ...marks,
                    final_ms: elapsed(),
                    audio_seconds: Math.round(secondsOf(pcm.subarray(0, Math.min(offset, limit)))),
                    model_calls: msg.stats?.model_calls ?? analyses,
                    label: msg.result.label,
                    score: msg.result.overall_score,
                });
                ws.close();
            }
        });
        ws.on('error', (e) => {
            clearInterval(timer);
            reject(e);
        });
    });
}

function percentile(values, p) {
    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (sorted.length === 0) return NaN;
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const fmt = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '-');

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.files.length === 0) {
        console.error('Usage: node bench/replay.js <audio files...> [--url URL] [--key KEY] [--only batch|stream] [--json out.json]');
        process.exit(1);
    }
    const paths = opts.only ? [opts.only] : ['batch', 'stream'];
    const rows = [];

    for (const file of opts.files) {
        const pcm = decodeToPcm(file);
        for (const p of paths) {
            try {
                const r = p === 'batch' ? await runBatch(pcm, opts) : await runStream(pcm, opts);
                rows.push({ file: path.basename(file), path: p, ...r });
                console.log(`${path.basename(file).padEnd(28)} ${p.padEnd(6)} first ${fmt(r.first_estimate_ms).padStart(6)}  final ${fmt(r.final_ms).padStart(6)}  audio ${String(r.audio_seconds).padStart(2)}s  calls ${r.model_calls}  ${r.label} (${r.score})`);
            } catch (e) {
                console.log(`${path.basename(file).padEnd(28)} ${p.padEnd(6)} FAILED: ${e.message}`);
            }
        }
    }

    console.log('\npath    n   first p50  first p95  final p50  final p95  audio/clip  calls/clip');
    for (const p of paths) {
        const r = rows.filter((x) => x.path === p);
        if (r.length === 0) continue;
        const mean = (k) => (r.reduce((sum, x) => sum + x[k], 0) / r.length).toFixed(1);
        console.log([
            p.padEnd(6), String(r.length).padStart(3),
            fmt(percentile(r.map((x) => x.first_estimate_ms), 50)).padStart(10),
            fmt(percentile(r.map((x) => x.first_estimate_ms), 95)).padStart(10),
            fmt(percentile(r.map((x) => x.final_ms), 50)).padStart(10),
            fmt(percentile(r.map((x) => x.final_ms), 95)).padStart(10),
            `${mean('audio_seconds')}s`.padStart(11),
            mean('model_calls').padStart(11),
        ].join(' '));
    }

    if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(rows, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
