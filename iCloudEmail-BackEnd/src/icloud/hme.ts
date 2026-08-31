import { config } from '../config.js';
import { z } from 'zod';
import { originForWebservice, USER_AGENT } from './constants.js';
import { fetchWithTimeout } from './http.js';
import type { AppleResponse, HmeEmail, HmeListResult } from './types.js';

/** Cookie-based iCloud session, as persisted per account. */
export interface HmeSession {
  cookie: string;
  webserviceUrl: string;
  dsid: string;
  clientId: string;
}

/**
 * Error from the iCloud API carrying the upstream HTTP status. Callers watch
 * for 401/421 to detect an expired session and trigger a silent refresh.
 */
export class HmeApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HmeApiError';
    this.status = status;
  }
}

function extractMessage(json: AppleResponse | undefined): string | null {
  if (!json) return null;
  if (typeof json.error === 'object' && json.error?.errorMessage) return json.error.errorMessage;
  if (typeof json.error === 'string') return json.error;
  return json.errorMessage ?? json.reason ?? null;
}

const hmeEmailSchema = z.object({
  origin: z.string(),
  anonymousId: z.string().min(1),
  domain: z.string(),
  forwardToEmail: z.string(),
  hme: z.string().min(3),
  isActive: z.boolean(),
  label: z.string(),
  note: z.string(),
  createTimestamp: z.number().finite(),
  recipientMailId: z.string(),
});

const hmeListSchema = z.object({
  // This field is intentionally required. Treating an absent field as an
  // authoritative empty list would make sync delete the entire local mirror.
  hmeEmails: z.array(hmeEmailSchema),
  selectedForwardTo: z.string().default(''),
  forwardToEmails: z.array(z.string()).default([]),
});

function invalidResponse(): HmeApiError {
  return new HmeApiError('iCloud 返回的数据格式异常，未修改本地数据，请稍后重试', 502);
}

function parseWire<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  return parsed.data;
}

/**
 * Hide My Email client: talks directly to the account's discovered
 * premiummailsettings webservice using the stored session cookie. Paths,
 * query params and bodies mirror the official iCloud web client.
 */
export class HmeClient {
  /** icloud.com vs icloud.com.cn — follows the account's webservice host. */
  private readonly origin: string;

  constructor(private readonly session: HmeSession) {
    this.origin = originForWebservice(session.webserviceUrl);
  }

  private url(path: string): string {
    const base = this.session.webserviceUrl.replace(/\/+$/, '');
    const u = new URL(base + path);
    u.searchParams.set('clientBuildNumber', config.icloud.clientBuildNumber);
    u.searchParams.set('clientMasteringNumber', config.icloud.clientMasteringNumber);
    u.searchParams.set('clientId', this.session.clientId);
    u.searchParams.set('dsid', this.session.dsid);
    return u.toString();
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const res = await fetchWithTimeout(this.url(path), {
      method,
      headers: {
        Cookie: this.session.cookie,
        Origin: this.origin,
        Referer: `${this.origin}/`,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json: AppleResponse<unknown> | undefined;
    try {
      json = text ? (JSON.parse(text) as AppleResponse<unknown>) : undefined;
    } catch {
      json = undefined;
    }

    if (!res.ok) {
      throw new HmeApiError(extractMessage(json) ?? `iCloud API 请求失败（HTTP ${res.status}）`, res.status);
    }
    if (json && json.success === false) {
      throw new HmeApiError(extractMessage(json) ?? 'iCloud API 调用失败', 400);
    }
    if (json && typeof json === 'object' && 'result' in json) return json.result;
    return json;
  }

  /** `GET /v2/hme/list` → all aliases + forwarding config. */
  async list(): Promise<HmeListResult> {
    return parseWire(hmeListSchema, await this.request('GET', '/v2/hme/list')) as HmeListResult;
  }

  /** `POST /v1/hme/generate` → a fresh, not-yet-reserved address. */
  async generate(): Promise<string> {
    const r = parseWire(
      z.object({ hme: z.string().min(3) }),
      await this.request('POST', '/v1/hme/generate', {}),
    );
    return r.hme;
  }

  /** `POST /v1/hme/reserve` → persists a generated address with label/note. */
  async reserve(hme: string, label: string, note = ''): Promise<HmeEmail> {
    const r = parseWire(
      z.object({ hme: hmeEmailSchema }),
      await this.request('POST', '/v1/hme/reserve', { hme, label, note }),
    );
    return r.hme;
  }

  /** Convenience: generate + reserve in sequence (one new alias). */
  async createAndReserve(label: string, note = ''): Promise<HmeEmail> {
    return this.reserve(await this.generate(), label, note);
  }

  /** `POST /v1/hme/updateMetaData` — change label/note. */
  async updateMetaData(anonymousId: string, label: string, note?: string): Promise<void> {
    await this.request('POST', '/v1/hme/updateMetaData', {
      anonymousId,
      label,
      ...(note !== undefined ? { note } : {}),
    });
  }

  async deactivate(anonymousId: string): Promise<void> {
    await this.request('POST', '/v1/hme/deactivate', { anonymousId });
  }

  async reactivate(anonymousId: string): Promise<void> {
    await this.request('POST', '/v1/hme/reactivate', { anonymousId });
  }

  async delete(anonymousId: string): Promise<void> {
    await this.request('POST', '/v1/hme/delete', { anonymousId });
  }

  /** `POST /v1/hme/updateForwardTo` — account-wide forwarding destination. */
  async updateForwardTo(forwardToEmail: string): Promise<void> {
    await this.request('POST', '/v1/hme/updateForwardTo', { forwardToEmail });
  }
}
