// Dependency-free helpers for building the public result shape. Shared by the
// batch (/analyze) and streaming (/stream) paths so both return identical results.

const MIN_WORDS_FOR_ANALYSIS = 8;

const countWords = (text) => text.split(/\s+/).filter(Boolean).length;

function notEnoughSpeech(wordCount) {
    // Music, silence or a few words: not enough speech to judge.
    return {
        is_political: false,
        topic: '',
        label: 'Not Enough Speech',
        overall_score: 0,
        economic_score: null,
        social_score: null,
        framing: null,
        confidence: 0,
        reasoning: wordCount === 0
            ? 'No speech was detected in this clip.'
            : 'Too little speech was detected to assess political content.',
        evidence: [],
        key_terms: [],
        news_query: '',
    };
}

function toResult({ videoId, sampleSeconds, transcription, analysis, relatedArticles = [], provisional = false }) {
    const { news_query, ...publicAnalysis } = analysis;
    return {
        video_id: videoId,
        analyzed_at: new Date().toISOString(),
        sample_seconds: sampleSeconds,
        transcription,
        ...publicAnalysis,
        related_articles: relatedArticles,
        ...(provisional && { provisional: true }),
    };
}

function publicErrorMessage(error) {
    const upstreamStatus = error.response?.status;
    if (upstreamStatus === 401 || upstreamStatus === 403) return 'The backend\'s transcription API key was rejected.';
    if (upstreamStatus === 429) return 'An upstream API rate limit was hit. Try again shortly.';
    if (/API key/i.test(error.message)) return 'The backend\'s Gemini API key is missing or invalid.';
    return 'Analysis failed. Check the backend logs for details.';
}

module.exports = { MIN_WORDS_FOR_ANALYSIS, countWords, notEnoughSpeech, toResult, publicErrorMessage };
