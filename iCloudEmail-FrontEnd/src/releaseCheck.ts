const LATEST_RELEASE_API = 'https://api.github.com/repos/LYH105/iCloudEmail-Lite/releases/latest';

export interface LatestRelease {
  version: string;
  name: string;
  url: string;
  publishedAt: string;
}

function versionParts(version: string): number[] {
  const core = version.trim().replace(/^v/i, '').split('-', 1)[0] ?? '';
  if (!/^\d+(?:\.\d+){0,3}$/.test(core)) return [];
  return core.split('.').map(Number);
}

/** True only when latest is a valid numeric version newer than current. */
export function isNewerVersion(latest: string, current: string): boolean {
  const left = versionParts(latest);
  const right = versionParts(current);
  if (left.length === 0 || right.length === 0) return false;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export async function fetchLatestRelease(signal?: AbortSignal): Promise<LatestRelease> {
  const response = await fetch(LATEST_RELEASE_API, {
    signal,
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
  const data = (await response.json()) as {
    tag_name?: unknown;
    name?: unknown;
    html_url?: unknown;
    published_at?: unknown;
  };
  if (
    typeof data.tag_name !== 'string' ||
    typeof data.html_url !== 'string' ||
    typeof data.published_at !== 'string'
  ) {
    throw new Error('GitHub Release 数据格式不正确');
  }
  return {
    version: data.tag_name.replace(/^v/i, ''),
    name: typeof data.name === 'string' && data.name ? data.name : data.tag_name,
    url: data.html_url,
    publishedAt: data.published_at,
  };
}
