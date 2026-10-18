export type Framing = 'informational' | 'opinion' | 'persuasive' | 'inflammatory';

export interface Evidence {
  quote: string;
  explanation: string;
}

export interface RelatedArticle {
  title: string;
  url: string;
  source: string;
}

/** Shape returned by the backend's /analyze and /analysis/:id endpoints. */
export interface AnalysisResult {
  video_id: string | null;
  analyzed_at: string;
  sample_seconds: number | null;
  cached: boolean;
  transcription: string;
  is_political: boolean;
  topic: string;
  label: string;
  /** -5 (left) .. +5 (right), 0 = center */
  overall_score: number;
  economic_score: number | null;
  social_score: number | null;
  framing: Framing | null;
  confidence: number;
  reasoning: string;
  evidence: Evidence[];
  key_terms: string[];
  related_articles: RelatedArticle[];
  /** Set on live estimates sent while the video is still being heard. */
  provisional?: boolean;
}

export const FRAMING_LABELS: Record<Framing, string> = {
  informational: 'Informational',
  opinion: 'Opinion',
  persuasive: 'Persuasive',
  inflammatory: 'Inflammatory',
};

/** Maps a -5..+5 score to a 0..100 position on the spectrum bar. */
export const scoreToPosition = (score: number) => ((score + 5) / 10) * 100;

export function scoreTone(score: number): 'left' | 'center' | 'right' {
  if (score < 0) return 'left';
  if (score > 0) return 'right';
  return 'center';
}
