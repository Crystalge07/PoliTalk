import { scoreToPosition } from '@/types/bias';
import { cn } from '@/lib/utils';

interface BiasSpectrumProps {
  /** -5..+5, or null while there is no result yet */
  score: number | null;
  pending?: boolean;
  size?: 'lg' | 'sm';
}

export const BiasSpectrum = ({ score, pending = false, size = 'lg' }: BiasSpectrumProps) => {
  const position = scoreToPosition(score ?? 0);

  return (
    <div className="relative w-full" role="img" aria-label={score === null ? 'No score' : `Score ${score} on a scale from -5 (left) to +5 (right)`}>
      <div className={cn('spectrum-bar w-full', size === 'lg' ? 'h-2.5' : 'h-1.5', score === null && 'opacity-30')} />
      {/* Center tick */}
      <div className="absolute left-1/2 top-0 h-full w-px bg-background/70" />
      {score !== null && (
        <div
          className={cn(
            'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-background bg-white shadow',
            size === 'lg' ? 'h-5 w-2' : 'h-3 w-1.5',
            pending && 'animate-pulse-slow',
          )}
          style={{ left: `${position}%`, transition: 'left 0.5s ease-out' }}
        />
      )}
    </div>
  );
};
