// Service worker: the only place that talks to the backend. Requests made from
// here carry the extension's own origin (not the website's), which lets the
// backend reject calls coming from web pages.
import { getSettings } from '@/lib/settings';
import type { BackgroundRequest, BackgroundResponse } from '@/lib/messaging';

async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { backendUrl, apiKey } = await getSettings();
  const base = backendUrl.replace(/\/+$/, '');
  const headers = new Headers(init.headers);
  if (apiKey) headers.set('X-PoliTalk-Key', apiKey);
  try {
    return await fetch(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(90_000) });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new Error('The backend took too long to respond.');
    throw new Error(`Can't reach the PoliTalk backend at ${base}. Is it running?`);
  }
}

async function errorFrom(response: Response): Promise<string> {
  if (response.status === 401) return 'The backend rejected the API key. Check it in the PoliTalk settings.';
  try {
    const body = await response.json();
    if (body.error) return body.error;
  } catch { /* fall through */ }
  return `Backend error (${response.status})`;
}

async function handle(request: BackgroundRequest): Promise<BackgroundResponse> {
  switch (request.type) {
    case 'lookup': {
      const response = await backendFetch(`/analysis/${encodeURIComponent(request.videoId)}`);
      if (response.status === 404) return { ok: true, data: null };
      if (!response.ok) return { ok: false, error: await errorFrom(response) };
      return { ok: true, data: await response.json() };
    }
    case 'analyze': {
      const bytes = Uint8Array.from(atob(request.audioBase64), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.append('audio', new Blob([bytes], { type: request.mimeType }), 'sample.webm');
      form.append('sample_seconds', String(request.sampleSeconds));
      if (request.videoId) form.append('video_id', request.videoId);

      const response = await backendFetch('/analyze', { method: 'POST', body: form });
      if (!response.ok) return { ok: false, error: await errorFrom(response) };
      return { ok: true, data: await response.json() };
    }
    case 'health': {
      const response = await backendFetch('/health');
      if (!response.ok) return { ok: false, error: await errorFrom(response) };
      return { ok: true, data: await response.json() };
    }
  }
}

chrome.runtime.onMessage.addListener((request: BackgroundRequest, _sender, sendResponse) => {
  handle(request)
    .then(sendResponse)
    .catch((e: Error) => sendResponse({ ok: false, error: e.message }));
  return true; // keep the channel open for the async response
});

// Nothing is recorded until the user has read the privacy notice, so show it on install.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html?welcome=1') });
  }
});
