/** Heuristic sign-in / verification link extraction from email HTML + text. */

export interface LinkCandidate {
  url: string;
  score: number; // higher = more likely the real sign-in / action link
  label: string; // anchor text (or a short hint) shown to the user
}

// Words that, in a link's anchor text or URL, suggest it's the action link
// (magic sign-in, verify, confirm…) the user actually needs.
const KEYWORDS = [
  'sign in',
  'signin',
  'sign-in',
  'log in',
  'login',
  'log-in',
  'magic',
  'verify',
  'verification',
  'confirm',
  'confirmation',
  'activate',
  'activation',
  'authenticate',
  'authentication',
  'reset password',
  'reset',
  'continue',
  'get started',
  'secure link',
  'one-time',
  '登录',
  '登陆',
  '验证',
  '确认',
  '激活',
  '安全链接',
  '点击',
  '点此',
];

// Links that are almost never the action the user wants — footer / social / assets.
const SKIP_SUBSTR = [
  'unsubscribe',
  'mailto:',
  '/privacy',
  '/terms',
  '/legal',
  '/help',
  '/support',
  'facebook.com',
  'twitter.com',
  'x.com/',
  'instagram.com',
  'linkedin.com',
  'youtube.com',
  'apple.com/legal',
];
const ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|css|ico|woff2?)(\?|$)/i;

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/gi, '&')
    .replace(/&#x2f;/gi, '/')
    .replace(/&#47;/gi, '/')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const stripTags = (s: string): string =>
  decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

function keywordScore(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of KEYWORDS) {
    if (lower.includes(kw)) {
      score += 3;
      break; // one keyword hit is enough — avoid stacking synonyms
    }
  }
  return score;
}

function isNoise(url: string): boolean {
  const lower = url.toLowerCase();
  if (!/^https?:\/\//.test(lower)) return true;
  if (ASSET_EXT.test(lower)) return true;
  return SKIP_SUBSTR.some((s) => lower.includes(s));
}

/**
 * Extract likely sign-in / verification links. Anchor text weighs most (a
 * "Sign in to X" button), the URL itself second. Only links that look like an
 * action (score > 0) are returned, best first — footer/social/asset links are
 * dropped. Falls back to scanning plain-text URLs when there's no HTML.
 */
export function extractLinks(subject: string, text: string, html: string | null): LinkCandidate[] {
  const seen = new Map<string, LinkCandidate>();

  const consider = (rawUrl: string, label: string) => {
    const url = decodeEntities(rawUrl.trim());
    if (isNoise(url)) return;
    const score = keywordScore(label) + Math.min(keywordScore(url), 3) + keywordScore(subject);
    if (score <= 0) return; // not an action link — skip
    const existing = seen.get(url);
    const candidate: LinkCandidate = { url, score, label: label || url };
    if (!existing || candidate.score > existing.score) seen.set(url, candidate);
  };

  if (html) {
    for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gis)) {
      consider(m[1] ?? '', stripTags(m[2] ?? ''));
    }
  }
  // Plain-text URLs (covers text-only mail and buttons whose label had no keyword).
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')]+/gi)) {
    consider(m[0], '');
  }

  return [...seen.values()].sort((a, b) => b.score - a.score);
}
