export type BiasLevel = 'strong-left' | 'left' | 'center' | 'right' | 'strong-right';

export interface BiasResult {
  level: BiasLevel;
  confidence: number; // 0-100
  reasoning: string;
  keywords: string[];
}

export interface AnalysisState {
  status: 'idle' | 'analyzing' | 'complete' | 'error';
  result: BiasResult | null;
  error: string | null;
}

export const BIAS_LABELS: Record<BiasLevel, string> = {
  'strong-left': 'Strong Left',
  'left': 'Left',
  'center': 'Center',
  'right': 'Right',
  'strong-right': 'Strong Right',
};

export const BIAS_POSITIONS: Record<BiasLevel, number> = {
  'strong-left': 0,
  'left': 25,
  'center': 50,
  'right': 75,
  'strong-right': 100,
};
