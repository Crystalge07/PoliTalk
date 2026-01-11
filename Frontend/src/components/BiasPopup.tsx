import { useState, useEffect } from 'react';
import { Scale, Eye, EyeOff, ChevronDown, Loader2, Newspaper, Link as LinkIcon, ExternalLink } from 'lucide-react';
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
  topic?: string;
  key_terms: string[];
  transcription?: string;
  related_articles?: { title: string; url: string; }[];
}

const mapScoreToLevel = (score: number): BiasLevel => {
  if (score <= 2) return 'strong-left';
  if (score <= 4) return 'left';
  if (score === 5) return 'center';
  if (score <= 8) return 'right';
  return 'strong-right';
};

export const BiasPopup = () => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [keywordsOpen, setKeywordsOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [transcriptionOpen, setTranscriptionOpen] = useState(false);
  const [data, setData] = useState<BiasData | null>(null);
  const [status, setStatus] = useState<'idle' | 'recording' | 'analyzing' | 'error' | 'no-video'>('no-video');
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  useEffect(() => {
    // Import dynamically to avoid SSR issues if any, though content script is client-only
    import('@/logic/recorder').then(({ setupPoliTok }) => {
      const cleanup = setupPoliTok(
        (s: any, details?: string) => {
          setStatus(s);
          if (details) setErrorDetails(details);
          else if (s !== 'error') setErrorDetails(null);
        },
        (d: any) => {
          console.log('PoliTok UI: Result received', d);
          setData(d);
          setIsExpanded(true); // Auto-expand popup
          // All other dropdowns (News, Keywords, Transcription) stay closed by default
        }
      );
      return cleanup;
    });
  }, []);

  // Use data if available, otherwise hide or show loading/placeholder
  const displayData = data || {
    bias_score: 5,
    bias_label: status === 'no-video' ? 'Searching for video...' : 'Waiting...',
    topic: '',
    key_terms: [],
    transcription: '',
    related_articles: []
  };

  const statusLabel = {
    'recording': 'Recording...',
    'analyzing': 'Gemini is thinking...',
    'error': 'Analysis Error',
    'idle': 'Watching',
    'no-video': 'Idle'
  }[status];

  if (!isExpanded) {
    return (
      <div className="fixed bottom-4 left-4 glass-panel p-2 flex items-center gap-2 cursor-pointer hover:bg-secondary/50 transition-colors shadow-lg border border-white/20"
        onClick={() => setIsExpanded(true)}>
        <img
          src={(window as any).chrome?.runtime?.getURL('logo.png') || '/logo.png'}
          alt="Logo"
          className="w-8 h-8 object-contain"
        />
        <div className="flex flex-col">
          <span className="text-[11px] font-bold text-foreground">PoliTalk</span>
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
            className="w-10 h-10 object-contain"
          />
          <div>
            <h1 className="text-lg font-bold text-foreground tracking-tight mb-0.5">PoliTalk</h1>
            <div className="flex items-center gap-1.5">
              {status === 'analyzing' || status === 'recording' ? (
                <Loader2 className="w-2.5 h-2.5 animate-spin text-primary" />
              ) : (
                <div className={cn("w-1.5 h-1.5",
                  status === 'idle' ? "bg-green-500" : "bg-muted-foreground"
                )} />
              )}
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{statusLabel}</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => setIsExpanded(false)}
          className="p-1.5 hover:bg-secondary transition-colors"
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

        {/* Status */}
        <div className="text-center p-3 bg-secondary/30 border border-white/5">
          <p className="text-lg font-bold tracking-tight text-foreground">{displayData.bias_label}</p>
        </div>

        {/* Related News Dropdown */}
        {data && status !== 'error' && (
          <Collapsible open={newsOpen} onOpenChange={setNewsOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-secondary/50 hover:bg-secondary transition-colors group">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Related News Articles</span>
              </div>
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform duration-200 group-hover:text-foreground",
                  newsOpen && "rotate-180"
                )}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-2 animate-fade-in">
              {displayData.related_articles && displayData.related_articles.length > 0 ? (
                displayData.related_articles
                  .filter(article => {
                    try {
                      new URL(article.url);
                      return true;
                    } catch {
                      console.warn('PoliTok: Invalid URL filtered:', article.url);
                      return false;
                    }
                  })
                  .map((article, i) => {
                    let hostname = 'Unknown Source';
                    try {
                      hostname = new URL(article.url).hostname.replace('www.', '');
                    } catch (e) {
                      console.error('PoliTok: URL parse error:', e);
                    }

                    return (
                      <a
                        key={i}
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-2 p-2 rounded-md bg-white/5 border border-white/5 hover:bg-white/10 transition-colors group/link"
                      >
                        <LinkIcon className="w-3 h-3 mt-1 text-primary shrink-0" />
                        <div className="flex-1 space-y-0.5">
                          <p className="text-xs font-medium text-foreground leading-snug group-hover/link:text-primary transition-colors">
                            {article.title}
                          </p>
                          <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                            <span>{hostname}</span>
                            <ExternalLink className="w-2 h-2" />
                          </div>
                        </div>
                      </a>
                    );
                  })
              ) : (
                <div className="p-3 bg-secondary/20 border border-white/5 text-center">
                  <p className="text-xs text-muted-foreground italic">
                    {displayData.bias_label.includes('Non-Political')
                      ? "No news articles available for non-political content."
                      : "Not enough context provided in this video to match reliable news articles."}
                  </p>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Keywords Dropdown */}
        {displayData.key_terms.length > 0 && (
          <Collapsible open={keywordsOpen} onOpenChange={setKeywordsOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-secondary/50 hover:bg-secondary transition-colors group">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Key Indicative Terms</span>
              </div>
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

        {/* Transcription Dropdown */}
        {displayData.transcription && status !== 'error' && (
          <Collapsible open={transcriptionOpen} onOpenChange={setTranscriptionOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-secondary/50 hover:bg-secondary transition-colors group">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Video Transcription</span>
              </div>
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform duration-200 group-hover:text-foreground",
                  transcriptionOpen && "rotate-180"
                )}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 animate-fade-in">
              <div className="p-3 bg-secondary/20 border border-white/5 max-h-[120px] overflow-y-auto">
                <p className="text-xs text-foreground italic leading-relaxed">"{displayData.transcription}"</p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Error Details */}
        {status === 'error' && errorDetails && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 max-h-[100px] overflow-y-auto">
            <p className="text-[10px] uppercase tracking-wider text-destructive mb-1 font-bold">Error Details</p>
            <p className="text-xs text-foreground italic leading-relaxed">{errorDetails}</p>
          </div>
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
