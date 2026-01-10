import { useState } from 'react';
import { Scale, Eye, EyeOff, ChevronDown } from 'lucide-react';
import { BiasSpectrum } from './BiasSpectrum';
import { KeywordTags } from './KeywordTags';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

// Sample keywords that indicate bias
const BIAS_KEYWORDS = {
  left: ['progressive', 'climate action', 'social justice', 'equity', 'systemic', 'marginalized'],
  right: ['traditional values', 'free market', 'liberty', 'patriot', 'deregulation', 'small government'],
};

export const BiasPopup = () => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [keywordsOpen, setKeywordsOpen] = useState(false);

  if (!isExpanded) {
    return (
      <div className="fixed bottom-4 left-4 glass-panel p-2 flex items-center gap-2 cursor-pointer hover:bg-secondary/50 transition-colors"
           onClick={() => setIsExpanded(true)}>
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-bias-left to-bias-right flex items-center justify-center">
          <Scale className="w-3 h-3 text-white" />
        </div>
        <span className="text-xs font-medium text-foreground">Bias</span>
        <Eye className="w-3.5 h-3.5 text-muted-foreground ml-1" />
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 w-[340px] glass-panel p-4 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-bias-left to-bias-right flex items-center justify-center">
            <Scale className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground">Bias Detector</h1>
            <p className="text-[10px] text-muted-foreground">TikTok Political Analysis</p>
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
        <BiasSpectrum 
          level={null} 
          isAnimating={false}
        />

        {/* Keywords Dropdown */}
        <Collapsible open={keywordsOpen} onOpenChange={setKeywordsOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
            <span className="text-sm font-medium text-foreground">Keywords that indicate bias</span>
            <ChevronDown 
              className={cn(
                "w-4 h-4 text-muted-foreground transition-transform duration-200",
                keywordsOpen && "rotate-180"
              )} 
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 space-y-3 animate-fade-in">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-bias-left mb-2">Left-leaning</p>
              <KeywordTags keywords={BIAS_KEYWORDS.left} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-bias-right mb-2">Right-leaning</p>
              <KeywordTags keywords={BIAS_KEYWORDS.right} />
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Footer */}
        <div className="pt-3 border-t border-border">
          <p className="text-[10px] text-muted-foreground text-center">
            AI-powered analysis • Results are estimates
          </p>
        </div>
      </div>
    </div>
  );
};
