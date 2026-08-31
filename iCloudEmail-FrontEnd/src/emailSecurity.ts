/** CSP used by the sandboxed email viewer. Remote content is opt-in. */
export function emailContentSecurityPolicy(allowRemoteContent: boolean): string {
  // Never downgrade an opted-in remote image request to plaintext HTTP.
  const images = allowRemoteContent ? 'data: blob: https:' : 'data: blob:';
  return `default-src 'none'; img-src ${images}; style-src 'unsafe-inline';`;
}
