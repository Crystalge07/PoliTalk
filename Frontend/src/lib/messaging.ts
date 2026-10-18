import type { AnalysisResult } from '@/types/bias';

export interface Health {
  ok: boolean;
  model: string;
  requires_key: boolean;
}

export type BackgroundRequest =
  | { type: 'lookup'; videoId: string }
  | { type: 'analyze'; audioBase64: string; mimeType: string; videoId: string | null; sampleSeconds: number }
  | { type: 'health' };

type ResponseData<R extends BackgroundRequest> =
  R extends { type: 'health' } ? Health :
  R extends { type: 'lookup' } ? AnalysisResult | null :
  AnalysisResult;

export type BackgroundResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** Sends a request to the service worker, which is the only part of the extension that talks to the backend. */
export function sendToBackground<R extends BackgroundRequest>(request: R): Promise<BackgroundResponse<ResponseData<R>>> {
  return new Promise((resolve) => {
    const invalidated = { ok: false as const, error: 'PoliTalk was updated or reloaded. Refresh this page.' };
    try {
      chrome.runtime.sendMessage(request, (response) => {
        resolve(chrome.runtime.lastError || !response ? invalidated : response);
      });
    } catch {
      resolve(invalidated);
    }
  });
}
