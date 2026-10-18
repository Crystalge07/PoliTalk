import { useState, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, Loader2, Minus, Mic, Play, Radio, RotateCw, AlertTriangle, Quote } from 'lucide-react';
import { BiasSpectrum } from './BiasSpectrum';
import { KeywordTags } from './KeywordTags';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { TrackerState } from '@/logic/recorder';
import { FRAMING_LABELS, type AnalysisResult } from '@/types/bias';

const logoUrl = chrome.runtime.getURL('logo.png');

const STATUS_TEXT: Record<TrackerState['phase'], string> = {
  'no-video': 'No video playing',
  checking: 'Checking…',
  ready: 'Ready',
  waiting: 'Waiting for playback',
  listening: 'Listening',
  analyzing: 'Analyzing',
  done: 'Analyzed',
  error: 'Error',
};

const formatScore = (n: number) => (n > 0 ? `+${n}` : String(n));

const timeAgo = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};

interface BiasPopupProps {
  state: TrackerState;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onAnalyze: () => void;
}

export const BiasPopup = ({ state, collapsed, onCollapsedChange, onAnalyze }: BiasPopupProps) => {
  const busy = state.phase === 'checking' || state.phase === 'listening' || state.phase === 'analyzing';
  const liveResult = busy ? state.provisional : null;
  const statusText = liveResult ? 'Live estimate' : STATUS_TEXT[state.phase];

  if (collapsed) {
    return (
      <button
        onClick={() => onCollapsedChange(false)}
        className="glass-panel flex items-center gap-2 p-2 pr-3 shadow-lg transition-colors hover:bg-secondary/60"
        aria-label="Open PoliTalk"
      >
        <img src={logoUrl} alt="" className="h-7 w-7 object-contain" />
        <div className="flex flex-col items-start text-left">
          <span className="text-[11px] font-bold">PoliTalk</span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {state.phase === 'done' && state.result ? state.result.label : liveResult ? `${liveResult.label} · live` : statusText}
          </span>
        </div>
        {busy && <Loader2 className="ml-1 h-3 w-3 animate-spin text-muted-foreground" />}
      </button>
    );
  }

  return (
    <div className="glass-panel flex max-h-[min(640px,calc(100vh-48px))] w-[340px] flex-col shadow-2xl animate-fade-in">
      <header className="flex items-center justify-between border-b border-white/10 p-3">
        <div className="flex items-center gap-2">
          <img src={logoUrl} alt="" className="h-8 w-8 object-contain" />
          <div>
            <h1 className="text-base font-bold leading-tight tracking-tight">PoliTalk</h1>
            <div className="flex items-center gap-1.5">
              {busy ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <span className={cn('h-1.5 w-1.5', state.phase === 'done' ? 'bg-green-500' : state.phase === 'error' ? 'bg-destructive' : 'bg-muted-foreground')} />
              )}
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{statusText}</span>
            </div>
          </div>
        </div>
        <button onClick={() => onCollapsedChange(true)} className="p-1.5 transition-colors hover:bg-secondary" aria-label="Minimize">
          <Minus className="h-4 w-4 text-muted-foreground" />
        </button>
      </header>

      <div className="space-y-3 overflow-y-auto p-3">
        {state.phase === 'done' && state.result ? (
          <ResultView result={state.result} onReanalyze={onAnalyze} />
        ) : liveResult ? (
          <ResultView result={liveResult} live={{ transcript: state.transcript, finishing: state.phase === 'analyzing' }} onReanalyze={onAnalyze} />
        ) : (
          <StatusView state={state} onAnalyze={onAnalyze} />
        )}
      </div>

      <footer className="border-t border-white/10 px-3 py-2 text-center text-[10px] text-muted-foreground">
        AI estimate from a short stretch of audio · may be wrong
      </footer>
    </div>
  );
};

function StatusView({ state, onAnalyze }: { state: TrackerState; onAnalyze: () => void }) {
  return (
    <div className="space-y-3">
      <BiasSpectrum score={null} />
      <SpectrumLabels />
      <div className="space-y-3 border border-white/5 bg-secondary/30 p-4 text-center">
        {state.phase === 'no-video' && <p className="text-sm text-muted-foreground">Play a video to analyze it.</p>}
        {state.phase === 'checking' && <p className="text-sm text-muted-foreground">Looking for an earlier analysis…</p>}
        {state.phase === 'waiting' && <p className="text-sm text-muted-foreground">Analysis starts once the video has played for a moment.</p>}
        {state.phase === 'ready' && (
          <>
            <p className="text-sm text-muted-foreground">Analyze this video's speech for political lean.</p>
            <ActionButton onClick={onAnalyze} icon={<Play className="h-3.5 w-3.5" />}>Analyze this video</ActionButton>
          </>
        )}
        {state.phase === 'listening' && (
          <>
            <p className="flex items-center justify-center gap-2 text-sm">
              <Mic className="h-4 w-4 animate-pulse-slow" /> Listening…
            </p>
            {state.transcript && <LiveTranscript text={state.transcript} />}
            <div className="h-1 w-full bg-secondary">
              <div className="h-full bg-foreground transition-[width] duration-500" style={{ width: `${Math.round(state.progress * 100)}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground">Counts only while the video plays. Audio is never stored.</p>
          </>
        )}
        {state.phase === 'analyzing' && (
          <>
            <p className="flex items-center justify-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Transcribing and analyzing…
            </p>
            {state.transcript && <LiveTranscript text={state.transcript} />}
          </>
        )}
        {state.phase === 'error' && (
          <>
            <p className="flex items-start justify-center gap-2 text-left text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span>{state.error}</span>
            </p>
            <ActionButton onClick={onAnalyze} icon={<RotateCw className="h-3.5 w-3.5" />}>Try again</ActionButton>
          </>
        )}
      </div>
    </div>
  );
}

interface LiveInfo {
  transcript: string;
  /** Capture has stopped and the final result is on its way. */
  finishing: boolean;
}

function ResultView({ result, live, onReanalyze }: { result: AnalysisResult; live?: LiveInfo; onReanalyze: () => void }) {
  const political = result.is_political;
  const lowConfidence = political && result.confidence < 50 && !live;
  const transcript = live?.transcript || result.transcription;

  return (
    <div className="space-y-3 animate-slide-up">
      {live && (
        <p className="flex items-center gap-2 border border-white/10 bg-white/5 p-2 text-[11px] leading-snug">
          {live.finishing ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Radio className="h-3 w-3 shrink-0 animate-pulse-slow" />}
          {live.finishing ? 'Finalizing and finding related coverage…' : 'Live estimate. It updates as the video plays.'}
        </p>
      )}
      <BiasSpectrum score={political ? result.overall_score : null} />
      <SpectrumLabels />

      <div className="border border-white/5 bg-secondary/30 p-3 text-center">
        <p className="text-lg font-bold tracking-tight">{result.label}</p>
        {political && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {result.topic && <>{result.topic} · </>}
            {result.framing && <>{FRAMING_LABELS[result.framing]} · </>}
            {result.confidence}% confidence
          </p>
        )}
      </div>

      {lowConfidence && (
        <p className="flex items-start gap-2 border border-yellow-500/20 bg-yellow-500/10 p-2 text-[11px] leading-snug">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-yellow-400" />
          Low confidence: the sample was short, ambiguous, or possibly sarcastic. Treat this score with caution.
        </p>
      )}

      {result.reasoning && <p className="text-xs leading-relaxed text-foreground/90">{result.reasoning}</p>}

      {political && (result.economic_score !== null || result.social_score !== null) && (
        <div className="space-y-2">
          <AxisRow label="Economic" score={result.economic_score} />
          <AxisRow label="Social" score={result.social_score} />
        </div>
      )}

      {result.evidence.length > 0 && (
        <Section title="Why this score" defaultOpen>
          <ul className="space-y-2">
            {result.evidence.map((e) => (
              <li key={e.quote} className="border-l-2 border-white/20 pl-2">
                <p className="flex gap-1 text-xs italic">
                  <Quote className="h-3 w-3 shrink-0 rotate-180 text-muted-foreground" />
                  {e.quote}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{e.explanation}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {political && !live && (
        <Section title="Related coverage" count={result.related_articles.length}>
          {result.related_articles.length > 0 ? (
            <div className="space-y-1.5">
              {result.related_articles.map((article) => (
                <a
                  key={article.url}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/link block border border-white/5 bg-white/5 p-2 transition-colors hover:bg-white/10"
                >
                  <p className="text-xs font-medium leading-snug">{article.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    {article.source} <ExternalLink className="h-2.5 w-2.5" />
                  </p>
                </a>
              ))}
            </div>
          ) : (
            <Empty>No matching coverage from the trusted outlet list.</Empty>
          )}
        </Section>
      )}

      {result.key_terms.length > 0 && (
        <Section title="Key terms">
          <KeywordTags keywords={result.key_terms} />
        </Section>
      )}

      <Section title="Transcript" defaultOpen={Boolean(live)}>
        {transcript ? (
          <p className="max-h-[140px] overflow-y-auto border border-white/5 bg-secondary/20 p-2 text-xs italic leading-relaxed">
            “{transcript}”
          </p>
        ) : (
          <Empty>No speech detected.</Empty>
        )}
      </Section>

      {!live && <div className="flex items-center justify-between pt-1 text-[10px] text-muted-foreground">
        <span>
          {result.sample_seconds ? `${result.sample_seconds}s sample · ` : ''}
          {result.cached ? 'saved ' : ''}{timeAgo(result.analyzed_at)}
        </span>
        <button onClick={onReanalyze} className="flex items-center gap-1 px-1.5 py-1 transition-colors hover:bg-secondary hover:text-foreground">
          <RotateCw className="h-3 w-3" /> Re-analyze
        </button>
      </div>}
    </div>
  );
}

/** The last few words heard, so the user can see live transcription working. */
function LiveTranscript({ text }: { text: string }) {
  const words = text.split(/\s+/);
  const tail = words.length > 24 ? `…${words.slice(-24).join(' ')}` : text;
  return <p className="text-left text-[11px] italic leading-snug text-muted-foreground">“{tail}”</p>;
}

function SpectrumLabels() {
  return (
    <div className="-mt-1 flex justify-between text-[10px] font-medium text-muted-foreground">
      <span className="text-bias-left">Left</span>
      <span>Center</span>
      <span className="text-bias-right">Right</span>
    </div>
  );
}

function AxisRow({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="grid grid-cols-[64px_1fr_28px] items-center gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <BiasSpectrum score={score} size="sm" />
      <span className="text-right tabular-nums text-muted-foreground">{score === null ? 'n/a' : formatScore(score)}</span>
    </div>
  );
}

function Section({ title, count, defaultOpen = false, children }: { title: string; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-center justify-between bg-secondary/50 px-3 py-2 transition-colors hover:bg-secondary">
        <span className="text-xs font-medium">
          {title}
          {count !== undefined && <span className="ml-1.5 text-muted-foreground">{count}</span>}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 animate-fade-in">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function ActionButton({ onClick, icon, children }: { onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90">
      {icon}
      {children}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="border border-white/5 bg-secondary/20 p-2 text-center text-xs italic text-muted-foreground">{children}</p>;
}
