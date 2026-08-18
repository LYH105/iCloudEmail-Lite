/** CSP used by the sandboxed email viewer. Remote content is opt-in. */
export function emailContentSecurityPolicy(allowRemoteContent: boolean): string {
  const images = allowRemoteContent ? 'data: blob: https: http:' : 'data: blob:';
  return `default-src 'none'; img-src ${images}; style-src 'unsafe-inline';`;
}
