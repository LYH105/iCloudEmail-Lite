/** Heuristic verification-code extraction from email subject + body. */

export interface CodeCandidate {
  code: string;
  score: number; // higher = more likely the real verification code
  context: string; // surrounding text snippet
}

const KEYWORDS = [
  'verification',
  'verify',
  'security code',
  'one-time',
  'one time',
  'passcode',
  'access code',
  'confirmation',
  'confirm',
  'otp',
  'code is',
  'your code',
  'authentication',
  '验证码',
  '校验码',
  '动态密码',
  'código',
  'code de',
  'bestätigungscode',
];

// Matches 4–8 digit runs, and grouped forms like "123-456" / "123 456".
const CODE_PATTERN = /\b(\d{3}[-\s]?\d{3}|\d{4,8})\b/g;

function normalize(code: string): string {
  return code.replace(/[-\s]/g, '');
}

/**
 * Extract likely verification codes. Scoring favors codes that sit near a
 * verification keyword, are 4–8 digits, and are Apple's typical 6-digit shape.
 */
export function extractCodes(subject: string, body: string): CodeCandidate[] {
  const text = `${subject}\n${body}`;
  const lower = text.toLowerCase();
  const seen = new Map<string, CodeCandidate>();

  for (const match of text.matchAll(CODE_PATTERN)) {
    const raw = match[0];
    const code = normalize(raw);
    if (code.length < 4 || code.length > 8) continue;
    if (/^(19|20)\d{2}$/.test(code)) continue; // skip year-like 4-digit numbers

    const index = match.index ?? 0;
    const windowStart = Math.max(0, index - 60);
    const windowEnd = Math.min(text.length, index + raw.length + 40);
    const contextLower = lower.slice(windowStart, windowEnd);

    let score = 1;
    if (code.length === 6) score += 3;
    else if (code.length === 4 || code.length === 8) score += 1;
    for (const kw of KEYWORDS) {
      if (contextLower.includes(kw)) {
        score += 5;
        break;
      }
    }
    // Subject-line codes are very often the real one.
    if (index < subject.length) score += 2;

    const candidate: CodeCandidate = {
      code,
      score,
      context: text.slice(windowStart, windowEnd).replace(/\s+/g, ' ').trim(),
    };
    const existing = seen.get(code);
    if (!existing || candidate.score > existing.score) seen.set(code, candidate);
  }

  return [...seen.values()].sort((a, b) => b.score - a.score);
}

/** Best single code guess, or null if none found. */
export function bestCode(subject: string, body: string): string | null {
  return extractCodes(subject, body)[0]?.code ?? null;
}
