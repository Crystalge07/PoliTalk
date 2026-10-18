import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { DEFAULT_SETTINGS, getSettings, updateSettings, type Settings } from '@/lib/settings';
import { sendToBackground } from '@/lib/messaging';
import type { Platform } from '@/logic/videoId';
import { cn } from '@/lib/utils';

const SITE_NAMES: Record<Platform, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' };

type Connection = { status: 'idle' | 'testing' } | { status: 'ok'; detail: string } | { status: 'error'; detail: string };

const App = () => {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  if (!settings) return null;

  const update = (patch: Partial<Settings>) => {
    setSettings({ ...settings, ...patch });
    updateSettings(patch);
  };

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-center gap-2">
        <img src="logo.png" alt="" className="h-9 w-9 object-contain" />
        <div>
          <h1 className="text-lg font-bold leading-tight">PoliTalk</h1>
          <p className="text-[11px] text-muted-foreground">Political lean, explained, for short videos</p>
        </div>
      </header>
      {settings.consented ? <SettingsView settings={settings} update={update} /> : <Consent onAccept={() => update({ consented: true, enabled: true })} />}
    </div>
  );
};

function Consent({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-2 border border-white/10 bg-secondary/40 p-3 text-xs leading-relaxed">
        <p className="flex items-center gap-1.5 font-semibold">
          <ShieldCheck className="h-4 w-4" /> Before you start
        </p>
        <p>When a video plays on TikTok, Instagram or YouTube, PoliTalk records <b>a short stretch of its audio</b> (up to about 30 seconds; no video) and sends it to the PoliTalk backend you configure.</p>
        <p>The backend sends that audio to <b>ElevenLabs</b> for transcription and the transcript to <b>Google Gemini</b> for analysis. Audio is processed in memory and never saved. Results are cached by video ID so the same video isn't analyzed twice.</p>
        <p>Scores are AI estimates and can be wrong. Use them as a prompt to think critically, not as a verdict.</p>
      </div>
      <button onClick={onAccept} className="w-full bg-primary py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
        I understand, turn on PoliTalk
      </button>
    </div>
  );
}

function SettingsView({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const [backendUrl, setBackendUrl] = useState(settings.backendUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [connection, setConnection] = useState<Connection>({ status: 'idle' });

  const testConnection = async () => {
    setConnection({ status: 'testing' });
    const response = await sendToBackground({ type: 'health' });
    if (!response.ok) setConnection({ status: 'error', detail: response.error });
    else if (response.data.requires_key && !apiKey) setConnection({ status: 'error', detail: 'This backend requires an API key.' });
    else setConnection({ status: 'ok', detail: `Connected · ${response.data.model}` });
  };

  const saveConnection = () => {
    const url = backendUrl.trim() || DEFAULT_SETTINGS.backendUrl;
    setBackendUrl(url);
    update({ backendUrl: url, apiKey: apiKey.trim() });
    setConnection({ status: 'idle' });
  };

  const dirty = backendUrl !== settings.backendUrl || apiKey !== settings.apiKey;

  return (
    <div className="space-y-4">
      <Row label="PoliTalk is on" hint="Turn off to stop all recording.">
        <Toggle checked={settings.enabled} onChange={(enabled) => update({ enabled })} />
      </Row>

      <Group title="When to analyze">
        <div className="grid grid-cols-2 gap-1">
          {(['auto', 'manual'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => update({ mode })}
              className={cn('border px-2 py-1.5 text-xs', settings.mode === mode ? 'border-foreground bg-foreground text-background' : 'border-white/10 hover:bg-secondary')}
            >
              {mode === 'auto' ? 'Automatically' : 'When I click'}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {settings.mode === 'auto'
            ? 'Each video you watch for more than a moment is analyzed.'
            : 'Nothing is recorded until you press Analyze in the on-page panel.'}
        </p>
      </Group>

      <Row label="Live analysis" hint="Show an estimate within seconds and refine it while the video plays.">
        <Toggle checked={settings.streaming} onChange={(streaming) => update({ streaming })} />
      </Row>

      <Group title="Sites">
        {(Object.keys(SITE_NAMES) as Platform[]).map((site) => (
          <Row key={site} label={SITE_NAMES[site]}>
            <Toggle checked={settings.sites[site]} onChange={(on) => update({ sites: { ...settings.sites, [site]: on } })} />
          </Row>
        ))}
      </Group>

      <Group title="Backend">
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">Server URL</span>
          <input value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} className="w-full border border-input bg-secondary px-2 py-1.5 text-xs outline-none focus:border-ring" spellCheck={false} />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">API key (only if the server sets POLITALK_API_KEY)</span>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full border border-input bg-secondary px-2 py-1.5 text-xs outline-none focus:border-ring" />
        </label>
        <div className="flex gap-2">
          <button onClick={saveConnection} disabled={!dirty} className="flex-1 bg-primary py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40">Save</button>
          <button onClick={testConnection} disabled={dirty || connection.status === 'testing'} className="flex-1 border border-white/10 py-1.5 text-xs hover:bg-secondary disabled:opacity-40">Test connection</button>
        </div>
        {connection.status === 'testing' && <Status icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}>Testing…</Status>}
        {connection.status === 'ok' && <Status icon={<CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}>{connection.detail}</Status>}
        {connection.status === 'error' && <Status icon={<XCircle className="h-3.5 w-3.5 text-destructive" />}>{connection.detail}</Status>}
      </Group>

      <p className="text-center text-[10px] text-muted-foreground">Scores are AI estimates and can be wrong.</p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn('relative h-5 w-9 shrink-0 transition-colors', checked ? 'bg-green-600' : 'bg-secondary')}
    >
      <span className={cn('absolute top-0.5 h-4 w-4 bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

function Status({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <p className="flex items-center gap-1.5 text-[11px]">{icon}{children}</p>;
}

export default App;
