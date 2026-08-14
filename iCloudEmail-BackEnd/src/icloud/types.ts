/*
 * Types aligned verbatim with Apple's iCloud web client (Hide My Email).
 * Field names must not be renamed — they mirror the wire format exactly.
 */

/** One Hide My Email alias as returned by the premiummailsettings service. */
export interface HmeEmail {
  origin: string;
  anonymousId: string;
  domain: string;
  forwardToEmail: string;
  hme: string;
  isActive: boolean;
  label: string;
  note: string;
  createTimestamp: number;
  recipientMailId: string;
}

/** Payload of `GET /v2/hme/list` (inside the `result` envelope). */
export interface HmeListResult {
  hmeEmails: HmeEmail[];
  selectedForwardTo: string;
  forwardToEmails: string[];
}

/** Generic Apple response envelope: `{ success, result }` or an error shape. */
export interface AppleResponse<T = unknown> {
  success?: boolean;
  timestamp?: number;
  result?: T;
  error?: number | string | { errorMessage?: string; errorCode?: number | string };
  errorMessage?: string;
  reason?: string;
}

/** Subset of the `setup/ws/1/validate` response this app consumes. */
export interface ValidateResponse {
  dsInfo?: {
    dsid?: string | number;
    appleId?: string;
    primaryEmail?: string;
    fullName?: string;
  };
  webservices?: Record<string, { url?: string; status?: string } | undefined>;
}
