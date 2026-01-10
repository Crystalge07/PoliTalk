import { BiasLevel, BIAS_LABELS } from '@/types/bias';
import { cn } from '@/lib/utils';

interface BiasIndicatorProps {
  level: BiasLevel;
  confidence: number;
}

export const BiasIndicator = ({ level, confidence }: BiasIndicatorProps) => {
  const getBiasColorClass = () => {
    switch (level) {
      case 'strong-left':
        return 'bg-bias-strong-left text-white';
      case 'left':
        return 'bg-bias-left text-white';
      case 'center':
        return 'bg-bias-center text-white';
      case 'right':
        return 'bg-bias-right text-white';
      case 'strong-right':
        return 'bg-bias-strong-right text-white';
    }
  };

  const getGlowClass = () => {
    if (level.includes('left')) return 'bias-glow-left';
    if (level.includes('right')) return 'bias-glow-right';
    return 'bias-glow-center';
  };

  return (
    <div className="flex items-center gap-3 animate-slide-up">
      <div
        className={cn(
          "px-3 py-1.5 rounded-lg font-semibold text-sm",
          getBiasColorClass(),
          getGlowClass()
        )}
      >
        {BIAS_LABELS[level]}
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-16 bg-secondary rounded-full overflow-hidden">
          <div 
            className="h-full bg-foreground/60 rounded-full transition-all duration-500"
            style={{ width: `${confidence}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          {confidence}%
        </span>
      </div>
    </div>
  );
};
