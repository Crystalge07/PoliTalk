import { PcmDownsampler, TARGET_SAMPLE_RATE, pcmToBase64 } from './pcm';
import { STREAM_PORT, type StreamClientMessage, type StreamServerMessage } from '@/lib/messaging';
import type { AnalysisResult } from '@/types/bias';

/**
 * Where a live session failed, so the caller can decide what to do:
 * - capture: this video's audio couldn't be processed (fall back to a recorded sample)
 * - connect: the backend has no live endpoint or is unreachable (fall back, and stop trying live)
 * - session: the backend reported an error (show it)
 */
export type StreamFailure = 'capture' | 'connect' | 'session';

export interface StreamHandlers {
  onTranscript(text: string): void;
  onProvisional(result: AnalysisResult): void;
  /** The backend has heard enough. Capture has stopped; the final result follows. */
  onStop(): void;
  onFinal(result: AnalysisResult): void;
  onError(error: string, failure: StreamFailure): void;
}

/** Audio is sent in 250 ms messages: small enough for low latency, few enough to keep overhead down. */
const FRAME_SAMPLES = TARGET_SAMPLE_RATE / 4;
const RESUME_TIMEOUT_MS = 1000;

/** Streams a video's audio to the backend through the service worker and relays live results. */
export class AudioStreamer {
  /** Milliseconds from start to each milestone, for latency measurement. */
  readonly timings: Partial<Record<'first_transcript' | 'first_estimate' | 'final', number>> = {};
  private readonly startedAt = performance.now();
  private port: chrome.runtime.Port | null = null;
  private ctx: AudioContext | null = null;
  private pending: Int16Array[] = [];
  private pendingLength = 0;
  private sentSamples = 0;
  private paused = false;
  private capturing = true;
  private ready = false;
  private settled = false;

  constructor(private readonly stream: MediaStream, videoId: string | null, private readonly handlers: StreamHandlers) {
    try {
      this.port = chrome.runtime.connect({ name: STREAM_PORT });
    } catch {
      // Reported asynchronously so the caller has finished setting up before any handler runs.
      queueMicrotask(() => this.fail('PoliTalk was updated or reloaded. Refresh this page.', 'session'));
      return;
    }
    this.port.onMessage.addListener((msg: StreamServerMessage) => this.onMessage(msg));
    this.port.onDisconnect.addListener(() => {
      this.port = null;
      this.fail('The live connection closed unexpectedly.', this.ready ? 'session' : 'connect');
    });
    this.post({ type: 'start', video_id: videoId });
    this.startCapture().catch(() => {
      if (this.capturing) this.fail("This video's audio can't be processed live.", 'capture');
    });
  }

  get sampleSeconds(): number {
    return Math.round(this.sentSamples / TARGET_SAMPLE_RATE);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  /** No more audio; the backend finalizes with what it has heard. */
  end() {
    this.stopCapture();
    this.post({ type: 'end' });
  }

  /** Abandons the session. The backend still caches a result if it heard enough speech. */
  cancel() {
    this.stopCapture();
    this.settled = true;
    this.port?.disconnect();
    this.port = null;
  }

  private async startCapture() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    if (ctx.state === 'suspended') {
      // Autoplay policy: audio processing is only allowed once the user has interacted with the page.
      await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS))]);
      // resume() may have changed the state, which TypeScript's narrowing can't see.
      if ((ctx.state as AudioContextState) !== 'running') throw new Error('AudioContext is suspended');
    }

    const downsampler = new PcmDownsampler(ctx.sampleRate);
    const onSamples = (samples: Float32Array) => this.onSamples(downsampler.push(samples));
    let processor: AudioNode;
    try {
      await ctx.audioWorklet.addModule(chrome.runtime.getURL('pcm-worklet.js'));
      const worklet = new AudioWorkletNode(ctx, 'politalk-pcm-capture');
      worklet.port.onmessage = (e: MessageEvent<Float32Array>) => onSamples(e.data);
      processor = worklet;
    } catch {
      // Some sites' Content Security Policy blocks loading the worklet module; this
      // deprecated node runs on the main thread but needs no module.
      const node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)));
      processor = node;
    }
    if (!this.capturing) return;

    // Processing nodes only run when connected to the output; a muted gain keeps them silent.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    ctx.createMediaStreamSource(this.stream).connect(processor);
    processor.connect(sink);
    sink.connect(ctx.destination);
  }

  private onSamples(pcm: Int16Array) {
    if (!this.capturing || this.paused || pcm.length === 0) return;
    this.pending.push(pcm);
    this.pendingLength += pcm.length;
    if (this.pendingLength >= FRAME_SAMPLES) this.flushAudio();
  }

  private flushAudio() {
    if (this.pendingLength === 0) return;
    const frame = new Int16Array(this.pendingLength);
    let offset = 0;
    for (const part of this.pending) {
      frame.set(part, offset);
      offset += part.length;
    }
    this.pending = [];
    this.pendingLength = 0;
    this.sentSamples += frame.length;
    this.post({ type: 'audio', data: pcmToBase64(frame) });
  }

  private stopCapture() {
    if (!this.capturing) return;
    this.flushAudio();
    this.capturing = false;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.stream.getTracks().forEach((t) => t.stop());
  }

  private post(msg: StreamClientMessage) {
    try {
      this.port?.postMessage(msg);
    } catch {
      // The port closed; onDisconnect reports it.
    }
  }

  private mark(name: keyof AudioStreamer['timings']) {
    this.timings[name] ??= Math.round(performance.now() - this.startedAt);
  }

  private onMessage(msg: StreamServerMessage) {
    if (this.settled) return;
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        break;
      case 'transcript':
        this.mark('first_transcript');
        this.handlers.onTranscript(msg.text);
        break;
      case 'analysis':
        this.mark('first_estimate');
        this.handlers.onProvisional(msg.result);
        break;
      case 'stop':
        this.stopCapture();
        this.handlers.onStop();
        break;
      case 'final':
        this.mark('first_estimate');
        this.mark('final');
        this.settled = true;
        this.stopCapture();
        this.port?.disconnect();
        this.port = null;
        this.handlers.onFinal(msg.result);
        break;
      case 'error':
        this.fail(msg.error, msg.transport && !this.ready ? 'connect' : 'session');
        break;
    }
  }

  private fail(error: string, failure: StreamFailure) {
    if (this.settled) return;
    this.settled = true;
    this.stopCapture();
    this.port?.disconnect();
    this.port = null;
    this.handlers.onError(error, failure);
  }
}
