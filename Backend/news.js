const axios = require('axios');
const { ai, GEMINI_MODEL } = require('./analysis');

// Outlet name by domain. Subdomains (e.g. www., edition.) match too.
const TRUSTED_SOURCES = {
    'reuters.com': 'Reuters',
    'apnews.com': 'Associated Press',
    'thecanadianpress.com': 'The Canadian Press',
    'pbs.org': 'PBS NewsHour',
    'npr.org': 'NPR',
    'thestar.com': 'Toronto Star',
    'cbc.ca': 'CBC',
    'cpac.ca': 'CPAC',
    'bbc.com': 'BBC',
    'bbc.co.uk': 'BBC',
    'forbes.com': 'Forbes',
    'thehill.com': 'The Hill',
    'marketwatch.com': 'MarketWatch',
    'morningbrew.com': 'Morning Brew',
    'newsweek.com': 'Newsweek',
    'reason.com': 'Reason',
    'wsj.com': 'Wall Street Journal',
};

const MAX_ARTICLES = 3;

function sourceForHost(hostname) {
    const host = hostname.toLowerCase().replace(/^www\./, '');
    for (const [domain, name] of Object.entries(TRUSTED_SOURCES)) {
        if (host === domain || host.endsWith('.' + domain)) return name;
    }
    return null;
}

// Grounding chunks link through a Google redirect; follow it to the real article URL.
async function resolveRedirect(uri) {
    try {
        const response = await axios.get(uri, {
            maxRedirects: 0,
            timeout: 4000,
            validateStatus: (s) => s >= 300 && s < 400,
        });
        return response.headers.location || null;
    } catch {
        return null;
    }
}

const decodeEntities = (s) => s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));

function titleFromSlug(url) {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const slug = segments.reverse().find((s) => /[a-z]-[a-z]/i.test(s)) || '';
    const words = slug.replace(/\.\w+$/, '').replace(/-?(id)?[0-9a-f]{6,}$/i, '').split('-').filter(Boolean);
    if (words.length === 0) return null;
    const text = words.join(' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

async function fetchTitle(url) {
    try {
        const response = await axios.get(url, {
            timeout: 4000,
            maxContentLength: 2 * 1024 * 1024,
            responseType: 'text',
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PoliTalk/2.0)' },
        });
        const html = String(response.data);
        const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
        const title = og?.[1] || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
        return title ? decodeEntities(title).trim() : null;
    } catch {
        return null;
    }
}

/**
 * Finds related coverage using Google Search grounding. Only URLs returned in the
 * grounding metadata (pages Google actually retrieved) are used, never URLs the
 * model writes in its text, so links cannot be hallucinated.
 */
async function findRelatedArticles(newsQuery, topic) {
    if (!newsQuery) return [];

    const outlets = [...new Set(Object.values(TRUSTED_SOURCES))].join(', ');
    const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Search for recent news articles about: ${newsQuery}\nTopic context: ${topic}\n\nPrefer coverage from these outlets: ${outlets}.\nBriefly summarise what the top articles report.`,
        config: {
            tools: [{ googleSearch: {} }],
            temperature: 0,
        },
    });

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const webChunks = chunks.map((c) => c.web).filter((w) => w && w.uri);

    // The chunk title is usually the site's domain, so pre-filter on it before
    // spending a request on resolving the redirect.
    const candidates = webChunks.filter((w) => !w.title || !w.title.includes('.') || sourceForHost(w.title));

    const resolved = await Promise.all(candidates.slice(0, 8).map(async (w) => {
        const url = w.uri.includes('grounding-api-redirect') ? await resolveRedirect(w.uri) : w.uri;
        if (!url) return null;
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            return null;
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
        const source = sourceForHost(parsed.hostname);
        return source ? { url: parsed.toString(), source } : null;
    }));

    const seen = new Set();
    const articles = resolved.filter((a) => {
        if (!a) return false;
        const key = a.url.split(/[?#]/)[0];
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, MAX_ARTICLES);

    return Promise.all(articles.map(async (a) => ({
        ...a,
        title: (await fetchTitle(a.url)) || titleFromSlug(a.url) || `${a.source} article`,
    })));
}

module.exports = { findRelatedArticles };
