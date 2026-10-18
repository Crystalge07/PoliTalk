import type { Platform } from '@/logic/videoId';

export type AnalysisMode = 'auto' | 'manual';

export interface Settings {
  /** User has read the privacy notice and agreed to send audio for analysis. */
  consented: boolean;
  enabled: boolean;
  mode: AnalysisMode;
  sites: Record<Platform, boolean>;
  backendUrl: string;
  apiKey: string;
  panelCollapsed: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  consented: false,
  enabled: false,
  mode: 'auto',
  sites: { tiktok: true, instagram: true, youtube: true },
  backendUrl: 'http://localhost:3000',
  apiKey: '',
  panelCollapsed: false,
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    sites: { ...DEFAULT_SETTINGS.sites, ...(stored.sites || {}) },
  } as Settings;
}

export function updateSettings(patch: Partial<Settings>): Promise<void> {
  return chrome.storage.local.set(patch);
}

export function onSettingsChanged(callback: (settings: Settings) => void): () => void {
  const listener = (_changes: unknown, area: string) => {
    if (area === 'local') getSettings().then(callback);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
