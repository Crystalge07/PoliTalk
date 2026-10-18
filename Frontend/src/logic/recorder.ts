import { getVideoKey, isSharableId, type Platform } from './videoId';
import { sendToBackground } from '@/lib/messaging';
import type { AnalysisMode } from '@/lib/settings';
import type { AnalysisResult } from '@/types/bias';

export type Phase =
  | 'no-video'   // nothing suitable is playing
  | 'checking'   // asking the backend whether this video was already analysed
  | 'ready'      // manual mode: waiting for the user to start an analysis
  | 'waiting'    // auto mode: waiting for the video to play long enough
  | 'listening'  // recording an audio sample
  | 'analyzing'  // sample sent, waiting for the backend
  | 'done'
  | 'error';

export interface TrackerState {
  phase: Phase;
  videoKey: string | null;
  result: AnalysisResult | null;
  error: string | null;
  /** 0..1 while listening */
  progress: number;
}

const POLL_MS = 500;
/** Length of the audio sample sent for analysis. Shorter samples are cheaper but less accurate. */
const SAMPLE_SECONDS = 20;
/** A sample cut short (scrolled away, video ended) is still analysed if it is at least this long. */
const MIN_SAMPLE_SECONDS = 5;
/** Auto mode: how long a video must play before we start listening, so fast scrolling costs nothing. */
const AUTO_START_DELAY_MS = 1500;
const MAX_SESSION_RESULTS = 200;
const NO_AUDIO_GIVE_UP_TICKS = 8;

interface Recording {
  key: string;
  video: HTMLVideoElement;
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  recordedMs: number;
  lastTime: number;
}

function pickMimeType(): string {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function isEligible(video: HTMLVideoElement, platform: Platform): boolean {
  if (platform === 'youtube') {
    // Only the main player on watch and Shorts pages; skips hover previews and ads.
    if (!/^\/(watch|shorts\/)/.test(location.pathname)) return false;
    if (video.closest('.ad-showing, #inline-player, ytd-video-preview')) return false;
  }
  return true;
}

/** The video the user is most likely watching: the most visible one, preferring one that is playing. */
function findActiveVideo(platform: Platform): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestScore = 0;
  for (const video of Array.from(document.querySelectorAll('video'))) {
    const rect = video.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 120) continue;
    const visibleHeight = Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top);
    const visibleWidth = Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left);
    if (visibleHeight <= 0 || visibleWidth <= 0) continue;
    const visibleFraction = (visibleHeight * visibleWidth) / (rect.width * rect.height);
    if (visibleFraction < 0.5 || !isEligible(video, platform)) continue;
    const score = visibleHeight * visibleWidth * (video.paused ? 1 : 3);
    if (score > bestScore) {
      bestScore = score;
      best = video;
    }
  }
  return best;
}

export class VideoTracker {
  private state: TrackerState = { phase: 'no-video', videoKey: null, result: null, error: null, progress: 0 };
  private readonly results = new Map<string, AnalysisResult>();
  private readonly errors = new Map<string, string>();
  private readonly pending = new Set<string>();
  private readonly lookedUp = new Set<string>();
  private recording: Recording | null = null;
  private playingSince = 0;
  private noAudioTicks = 0;
  private interval: number | undefined;

  constructor(
    private readonly platform: Platform,
    private mode: AnalysisMode,
    private readonly onChange: (state: TrackerState) => void,
  ) {}

  start() {
    this.interval = window.setInterval(() => this.tick(), POLL_MS);
    this.tick();
  }

  stop() {
    window.clearInterval(this.interval);
    this.cancelRecording();
  }

  setMode(mode: AnalysisMode) {
    this.mode = mode;
    const key = this.state.videoKey;
    if (key && !this.recording && (this.state.phase === 'ready' || this.state.phase === 'waiting')) {
      this.emit({ phase: this.idlePhase() });
    }
  }

  /** Starts (or restarts) an analysis of the current video, ignoring any earlier result. */
  analyzeNow() {
    const key = this.state.videoKey;
    const video = findActiveVideo(this.platform);
    if (!key || !video || this.recording || this.pending.has(key)) return;
    this.results.delete(key);
    this.errors.delete(key);
    this.lookedUp.add(key);
    this.startRecording(video, key, true);
  }

  private emit(patch: Partial<TrackerState>) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  private idlePhase(): Phase {
    return this.mode === 'auto' ? 'waiting' : 'ready';
  }

  private tick() {
    const video = findActiveVideo(this.platform);
    const key = video ? getVideoKey(video, this.platform) : null;

    if (this.recording && this.recording.key !== key) {
      // The user moved on mid-sample; keep what we have if it is long enough.
      this.finishRecording();
    }

    if (video && !video.crossOrigin && !video.currentSrc.startsWith('blob:')) {
      // CDN-hosted files must be loaded with CORS or their audio can't be recorded.
      // Takes effect from the element's next load.
      video.crossOrigin = 'anonymous';
    }

    if (key !== this.state.videoKey) {
      this.playingSince = 0;
      this.noAudioTicks = 0;
      this.showVideo(key);
    }
    if (!video || !key) return;

    if (video.paused) this.playingSince = 0;
    else if (!this.playingSince) this.playingSince = Date.now();

    if (this.recording) {
      this.updateRecording(video);
      return;
    }

    const autoReady = this.state.phase === 'waiting' && this.playingSince > 0
      && Date.now() - this.playingSince >= AUTO_START_DELAY_MS;
    if (autoReady) this.startRecording(video, key);
  }

  /** Shows whatever is known about a newly active video, looking it up in the backend cache if needed. */
  private showVideo(key: string | null) {
    if (!key) {
      this.emit({ phase: 'no-video', videoKey: null, result: null, error: null, progress: 0 });
      return;
    }
    const base = { videoKey: key, result: null, error: null, progress: 0 };
    const result = this.results.get(key);
    if (result) return this.emit({ ...base, phase: 'done', result });
    if (this.errors.has(key)) return this.emit({ ...base, phase: 'error', error: this.errors.get(key)! });
    if (this.pending.has(key)) return this.emit({ ...base, phase: 'analyzing' });

    if (!isSharableId(key) || this.lookedUp.has(key)) return this.emit({ ...base, phase: this.idlePhase() });

    this.lookedUp.add(key);
    this.emit({ ...base, phase: 'checking' });
    sendToBackground({ type: 'lookup', videoId: key }).then((response) => {
      if (response.ok && response.data) this.storeResult(key, response.data);
      // A failed lookup is not fatal; analysing will surface any real problem.
      if (this.state.videoKey !== key || this.state.phase !== 'checking') return;
      this.showVideo(key);
    });
  }

  private startRecording(video: HTMLVideoElement, key: string, userInitiated = false) {
    let stream: MediaStream;
    try {
      const source: MediaStream = (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
      const audio = source.getAudioTracks();
      if (audio.length === 0) {
        // Tracks can appear a moment after playback starts.
        if (userInitiated) this.fail(key, 'No audio yet. Play the video, then try again.');
        else if (++this.noAudioTicks >= NO_AUDIO_GIVE_UP_TICKS) this.fail(key, 'This video has no audio to analyze.');
        return;
      }
      stream = new MediaStream(audio);
    } catch {
      this.fail(key, "This video's audio can't be captured.");
      return;
    }

    try {
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 48_000 });
      const recording: Recording = { key, video, recorder, stream, chunks: [], recordedMs: 0, lastTime: video.currentTime };
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recording.chunks.push(e.data);
      };
      recorder.start(1000);
      if (video.paused) recorder.pause();
      this.recording = recording;
      this.emit({ phase: 'listening', progress: 0, error: null });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      this.fail(key, "This video's audio can't be recorded (it may be protected).");
    }
  }

  private updateRecording(video: HTMLVideoElement) {
    const rec = this.recording!;
    // Only time spent actually playing counts towards the sample.
    if (video.paused) {
      if (rec.recorder.state === 'recording') rec.recorder.pause();
    } else {
      if (rec.recorder.state === 'paused') rec.recorder.resume();
      rec.recordedMs += POLL_MS;
    }

    // Short clips loop; once playback wraps around, the rest would be a repeat.
    const looped = video.currentTime < rec.lastTime - 1;
    rec.lastTime = video.currentTime;
    const nearEnd = video.duration > 0 && video.duration - video.currentTime < 0.3;
    // A very short looping clip keeps recording until the sample is long enough.
    const clipOver = (nearEnd || looped) && rec.recordedMs >= MIN_SAMPLE_SECONDS * 1000;
    if (rec.recordedMs >= SAMPLE_SECONDS * 1000 || clipOver || video.ended) {
      this.finishRecording();
    } else {
      this.emit({ progress: rec.recordedMs / (SAMPLE_SECONDS * 1000) });
    }
  }

  private cancelRecording() {
    const rec = this.recording;
    if (!rec) return;
    this.recording = null;
    rec.recorder.ondataavailable = null;
    if (rec.recorder.state !== 'inactive') rec.recorder.stop();
    rec.stream.getTracks().forEach((t) => t.stop());
  }

  private finishRecording() {
    const rec = this.recording!;
    const seconds = Math.round(rec.recordedMs / 1000);
    if (seconds < MIN_SAMPLE_SECONDS) {
      this.cancelRecording();
      if (this.state.videoKey === rec.key) this.emit({ phase: this.idlePhase(), progress: 0 });
      return;
    }

    this.recording = null;
    this.pending.add(rec.key);
    if (this.state.videoKey === rec.key) this.emit({ phase: 'analyzing', progress: 1 });

    rec.recorder.onstop = async () => {
      rec.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(rec.chunks, { type: rec.recorder.mimeType || 'audio/webm' });
      const response = await sendToBackground({
        type: 'analyze',
        audioBase64: await blobToBase64(blob),
        mimeType: blob.type.split(';')[0],
        videoId: isSharableId(rec.key) ? rec.key : null,
        sampleSeconds: seconds,
      });
      this.pending.delete(rec.key);
      if (response.ok) this.storeResult(rec.key, response.data);
      else this.errors.set(rec.key, response.error);
      if (this.state.videoKey === rec.key) this.showVideo(rec.key);
    };
    rec.recorder.stop();
  }

  private fail(key: string, error: string) {
    this.errors.set(key, error);
    if (this.state.videoKey === key) this.emit({ phase: 'error', error });
  }

  private storeResult(key: string, result: AnalysisResult) {
    this.results.delete(key);
    this.results.set(key, result);
    if (this.results.size > MAX_SESSION_RESULTS) this.results.delete(this.results.keys().next().value!);
  }
}
