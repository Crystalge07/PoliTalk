// Turns a finished transcript into a full result, including related coverage.
const { analyzeTranscript, filterEvidence } = require('./analysis');
const { findRelatedArticles } = require('./news');
const { MIN_WORDS_FOR_ANALYSIS, countWords, notEnoughSpeech, toResult } = require('./result');

/**
 * Full analysis of a finished transcript, including related coverage.
 * `prior` is an analysis already computed for (nearly) the same text; when given,
 * it is reused instead of calling the model again.
 */
async function analyzeFinal(transcription, { videoId = null, sampleSeconds = null, prior = null } = {}) {
    const timings = {};
    const wordCount = countWords(transcription);
    let analysis;
    let relatedArticles = [];

    if (wordCount < MIN_WORDS_FOR_ANALYSIS) {
        analysis = notEnoughSpeech(wordCount);
    } else {
        const started = Date.now();
        analysis = prior
            ? { ...prior, evidence: filterEvidence(prior.evidence, transcription) }
            : await analyzeTranscript(transcription);
        timings.analysis_ms = Date.now() - started;

        if (analysis.is_political && analysis.news_query) {
            const newsStarted = Date.now();
            try {
                relatedArticles = await findRelatedArticles(analysis.news_query, analysis.topic);
            } catch (e) {
                // Articles are supplementary; never fail the whole analysis over them.
                console.warn('Related article lookup failed:', e.message);
            }
            timings.news_ms = Date.now() - newsStarted;
        }
    }

    return { result: toResult({ videoId, sampleSeconds, transcription, analysis, relatedArticles }), timings };
}

module.exports = { analyzeFinal };
