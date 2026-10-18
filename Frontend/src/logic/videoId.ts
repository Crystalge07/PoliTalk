export type Platform = 'tiktok' | 'instagram' | 'youtube';

export function getPlatform(): Platform | null {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname.endsWith('tiktok.com')) return 'tiktok';
  if (hostname.endsWith('instagram.com')) return 'instagram';
  if (hostname.endsWith('youtube.com')) return 'youtube';
  return null;
}

/** Keys with this prefix are only meaningful on this page and are never sent to the backend cache. */
export const LOCAL_ID_PREFIX = 'local-';

export const isSharableId = (key: string) => !key.split(':')[1]?.startsWith(LOCAL_ID_PREFIX);

function findInAncestors(start: Element, maxDepth: number, match: (el: Element) => string | null): string | null {
  let el: Element | null = start;
  for (let depth = 0; el && depth < maxDepth; depth++, el = el.parentElement) {
    const found = match(el);
    if (found) return found;
  }
  return null;
}

function linkedId(container: Element, pattern: RegExp): string | null {
  for (const a of Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const m = a.getAttribute('href')!.match(pattern);
    if (m) return m[1];
  }
  return null;
}

function youtubeId(video: HTMLVideoElement): string | null {
  const shorts = location.pathname.match(/^\/shorts\/([\w-]{6,})/);
  if (shorts) return shorts[1];
  if (location.pathname === '/watch' && video.closest('#movie_player')) {
    return new URLSearchParams(location.search).get('v');
  }
  return null;
}

function instagramId(video: HTMLVideoElement): string | null {
  // Feed posts: the post's own permalink lives inside its <article>.
  const article = video.closest('article');
  if (article) {
    const id = linkedId(article, /\/(?:p|reels?)\/([\w-]+)/);
    if (id) return id;
  }
  // Reels viewer: the URL tracks the reel currently on screen.
  return location.pathname.match(/^\/(?:reels?|p)\/([\w-]+)/)?.[1] ?? null;
}

function tiktokId(video: HTMLVideoElement): string | null {
  // Feed items carry the numeric video ID in a nearby element id or permalink.
  const nearby = findInAncestors(video, 10, (el) =>
    el.id.match(/(\d{15,})/)?.[1] ?? linkedId(el, /\/video\/(\d{15,})/));
  if (nearby) return nearby;
  return location.pathname.match(/\/video\/(\d{15,})/)?.[1] ?? null;
}

let localCounter = 0;
const localIds = new WeakMap<HTMLVideoElement, { src: string; id: string }>();

/**
 * Returns a stable key ("platform:id") for the video currently in this element.
 * Prefers the platform's real video ID so results can be cached and reused; falls
 * back to a page-local ID that changes whenever the element's source changes.
 */
export function getVideoKey(video: HTMLVideoElement, platform: Platform): string {
  const extractors = { youtube: youtubeId, instagram: instagramId, tiktok: tiktokId };
  const id = extractors[platform](video);
  if (id && /^[\w-]+$/.test(id)) return `${platform}:${id}`;

  const src = video.currentSrc || video.src;
  let local = localIds.get(video);
  if (!local || local.src !== src) {
    local = { src, id: `${LOCAL_ID_PREFIX}${++localCounter}` };
    localIds.set(video, local);
  }
  return `${platform}:${local.id}`;
}
