import { BiasLevel, BIAS_POSITIONS } from '@/types/bias';
import { cn } from '@/lib/utils';

interface BiasSpectrumProps {
  level: BiasLevel | null;
  isAnimating?: boolean;
}

export const BiasSpectrum = ({ level, isAnimating = false }: BiasSpectrumProps) => {
  const position = level ? BIAS_POSITIONS[level] : 50;
  
  const getGlowClass = () => {
    if (!level) return '';
    if (level.includes('left')) return 'bias-glow-left';
    if (level.includes('right')) return 'bias-glow-right';
    return 'bias-glow-center';
  };

  return (
    <div className="w-full space-y-2">
      {/* Spectrum Bar */}
      <div className="relative h-3 rounded-full spectrum-bar overflow-hidden">
        {/* Indicator */}
        <div
          className={cn(
            "absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white border-2 border-background bias-indicator",
            getGlowClass(),
            isAnimating && "animate-pulse-slow"
          )}
          style={{ 
            left: `calc(${position}% - 10px)`,
            transition: 'left 0.5s ease-out'
          }}
        />
      </div>
      
      {/* Labels */}
      <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
        <span className="text-bias-strong-left">Strong Left</span>
        <span className="text-bias-left">Left</span>
        <span className="text-bias-center">Center</span>
        <span className="text-bias-right">Right</span>
        <span className="text-bias-strong-right">Strong Right</span>
      </div>
    </div>
  );
};
