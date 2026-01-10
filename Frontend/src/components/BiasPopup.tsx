import { useState, useEffect } from 'react';
import { Scale, Eye, EyeOff, ChevronDown, Loader2 } from 'lucide-react';
import { BiasSpectrum } from './BiasSpectrum';
import { KeywordTags } from './KeywordTags';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

import { BiasLevel } from '@/types/bias';

// Default/Mock data structure
interface BiasData {
  bias_score: number;
  bias_label: string;
  key_terms: string[];
  transcription?: string;
}

const mapScoreToLevel = (score: number): BiasLevel => {
  if (score <= 2) return 'strong-left';
  if (score <= 4) return 'left';
  if (score <= 6) return 'center';
  if (score <= 8) return 'right';
  return 'strong-right';
};

export const BiasPopup = () => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [keywordsOpen, setKeywordsOpen] = useState(false);
  const [data, setData] = useState<BiasData | null>(null);
  const [status, setStatus] = useState<'idle' | 'recording' | 'analyzing' | 'error' | 'no-video'>('no-video');

  useEffect(() => {
    // Import dynamically to avoid SSR issues if any, though content script is client-only
    import('@/logic/recorder').then(({ setupPoliTok }) => {
      const cleanup = setupPoliTok(
        (s: any) => setStatus(s),
        (d: any) => {
          console.log('PoliTok UI: Result received', d);
          setData(d);
          setIsExpanded(true); // Auto-expand when new data arrives
        }
      );
      return cleanup;
    });
  }, []);

  // Use data if available, otherwise hide or show loading/placeholder
  const displayData = data || {
    bias_score: 5,
    bias_label: status === 'no-video' ? 'Searching for video...' : 'Waiting...',
    key_terms: [],
    transcription: ''
  };

  const statusLabel = {
    'recording': 'Recording...',
    'analyzing': 'Gemini is thinking...',
    'error': 'Analysis Error',
    'idle': 'Watching',
    'no-video': 'No video found'
  }[status];

  if (!isExpanded) {
    return (
      <div className="fixed bottom-4 left-4 glass-panel p-2 flex items-center gap-2 cursor-pointer hover:bg-secondary/50 transition-colors shadow-lg border border-white/20"
        onClick={() => setIsExpanded(true)}>
        <img
          src={(window as any).chrome?.runtime?.getURL('logo.png') || '/logo.png'}
          alt="Logo"
          className="w-8 h-8 rounded-md object-contain"
        />
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-foreground">POLITOK</span>
          <span className="text-[8px] text-muted-foreground uppercase">{statusLabel}</span>
        </div>
        <Eye className="w-3.5 h-3.5 text-muted-foreground ml-1" />
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 w-[340px] glass-panel p-4 space-y-4 animate-fade-in shadow-2xl border border-white/20 z-[999999]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img
            src={(window as any).chrome?.runtime?.getURL('logo.png') || '/logo.png'}
            alt="Logo"
            className="w-10 h-10 rounded-lg object-contain"
          />
          <div>
            <h1 className="text-sm font-bold text-foreground tracking-tight">PoliTok Analysis</h1>
            <div className="flex items-center gap-1.5">
              {status === 'analyzing' || status === 'recording' ? (
                <Loader2 className="w-2.5 h-2.5 animate-spin text-primary" />
              ) : (
                <div className={cn("w-1.5 h-1.5 rounded-full",
                  status === 'idle' ? "bg-green-500" : "bg-muted-foreground"
                )} />
              )}
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{statusLabel}</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => setIsExpanded(false)}
          className="p-1.5 rounded-md hover:bg-secondary transition-colors"
        >
          <EyeOff className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <div className="space-y-4 animate-fade-in">
        {/* Spectrum */}
        <div className="relative pt-2">
          <BiasSpectrum
            level={data ? mapScoreToLevel(displayData.bias_score) : null}
            isAnimating={status === 'analyzing' || !data}
          />
        </div>

        {/* Info summary */}
        <div className="text-center p-3 rounded-lg bg-secondary/30 border border-white/5">
          <span className="text-lg font-bold tracking-tight">{displayData.bias_label}</span>
        </div>

        {/* Transcription */}
        {displayData.transcription && (
          <div className="p-3 rounded-lg bg-secondary/20 border border-white/5 max-h-[100px] overflow-y-auto">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-bold">Transcription</p>
            <p className="text-xs text-foreground italic leading-relaxed">"{displayData.transcription}"</p>
          </div>
        )}

        {/* Keywords Dropdown */}
        {displayData.key_terms.length > 0 && (
          <Collapsible open={keywordsOpen} onOpenChange={setKeywordsOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors group">
              <span className="text-sm font-medium text-foreground">Key Terms Detected</span>
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform duration-200 group-hover:text-foreground",
                  keywordsOpen && "rotate-180"
                )}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 animate-fade-in">
              <KeywordTags keywords={displayData.key_terms} />
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Footer */}
        <div className="pt-3 border-t border-white/10">
          <p className="text-[10px] text-muted-foreground text-center font-medium">
            AI-powered analysis • Results are estimates
          </p>
        </div>
      </div>
    </div>
  );
};
