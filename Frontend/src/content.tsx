import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BiasPopup } from '@/components/BiasPopup';
import { VideoTracker, type TrackerState } from '@/logic/recorder';
import { getPlatform, type Platform } from '@/logic/videoId';
import { getSettings, onSettingsChanged, updateSettings, type Settings } from '@/lib/settings';
import css from './index.css?inline';

const CONTAINER_ID = 'politalk-root';

const isActive = (s: Settings, platform: Platform) => s.consented && s.enabled && s.sites[platform];

function Panel({ platform, initial }: { platform: Platform; initial: Settings }) {
  const [settings, setSettings] = useState(initial);
  const [state, setState] = useState<TrackerState | null>(null);
  const tracker = useRef<VideoTracker | null>(null);

  useEffect(() => {
    const t = new VideoTracker(platform, initial.mode, setState);
    tracker.current = t;
    t.start();
    const unsubscribe = onSettingsChanged((s) => {
      setSettings(s);
      t.setMode(s.mode);
    });
    return () => {
      unsubscribe();
      t.stop();
    };
  }, [platform, initial.mode]);

  if (!state) return null;
  return (
    <BiasPopup
      state={state}
      collapsed={settings.panelCollapsed}
      onCollapsedChange={(panelCollapsed) => updateSettings({ panelCollapsed })}
      onAnalyze={() => tracker.current?.analyzeNow()}
    />
  );
}

let root: Root | null = null;

function mount(platform: Platform, settings: Settings) {
  if (root && document.getElementById(CONTAINER_ID)) return;
  unmount();

  const host = document.createElement('div');
  host.id = CONTAINER_ID;
  host.style.setProperty('all', 'initial');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('bottom', '24px', 'important');
  host.style.setProperty('left', '24px', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');
  document.documentElement.appendChild(host);

  // A closed shadow root keeps page scripts and styles away from the panel.
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = css;
  const rootDiv = document.createElement('div');
  rootDiv.className = 'extension-root';
  shadow.append(style, rootDiv);

  root = createRoot(rootDiv);
  root.render(<Panel platform={platform} initial={settings} />);
}

function unmount() {
  root?.unmount();
  root = null;
  document.getElementById(CONTAINER_ID)?.remove();
}

async function init() {
  const platform = getPlatform();
  if (!platform) return;

  const apply = (s: Settings) => (isActive(s, platform) ? mount(platform, s) : unmount());
  apply(await getSettings());
  onSettingsChanged(apply);

  // Single-page apps occasionally wipe foreign nodes from <html>; put the panel back.
  setInterval(async () => {
    if (root && !document.getElementById(CONTAINER_ID)) {
      root.unmount();
      root = null;
      apply(await getSettings());
    }
  }, 2000);
}

init();
