import { Loader2 } from 'lucide-react';

export const AnalyzingState = () => {
  return (
    <div className="flex flex-col items-center gap-3 py-4 animate-fade-in">
      <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
      <p className="text-sm text-muted-foreground">Analyzing political bias...</p>
    </div>
  );
};
