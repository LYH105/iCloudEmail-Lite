export type AccountStatus = 'awaiting_code' | 'active' | 'session_expired' | 'error';

export interface AccountPublic {
  id: string;
  label: string;
  appleId: string | null;
  dsid: string | null;
  webserviceUrl: string | null;
  china: boolean;
  status: AccountStatus;
  lastError: string | null;
  hasPassword: boolean;
  autoCreateEnabled: boolean;
  disabled: boolean;
  hasImap: boolean;
  imapUsername: string | null;
  imapAuthFailed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AliasMarkHit {
  mark: string;
  hitAt: number;
  source: string | null;
}

export interface AliasPublic {
  id: string;
  accountId: string;
  anonymousId: string;
  hme: string;
  domain: string | null;
  forwardToEmail: string | null;
  label: string | null;
  note: string | null;
  origin: string | null;
  isActive: boolean;
  recipientMailId: string | null;
  createTimestamp: number | null;
  syncedAt: number;
  marks: AliasMarkHit[];
  used: boolean;
  usedAt: number | null;
}

export interface MarkRuleExport {
  mark: string;
  fromContains: string | null;
  subjectContains: string | null;
  bodyContains: string | null;
  enabled: boolean;
}

export interface MarkRule {
  id: string;
  mark: string;
  fromContains: string | null;
  subjectContains: string | null;
  bodyContains: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A mark still on aliases that no rule produces any more (renamed/deleted rule). */
export interface OrphanMark {
  mark: string;
  aliases: number;
  lastHitAt: number;
}

export interface ScanResult {
  scanned: number;
  updated: { hme: string; mark: string }[];
}

export interface ApiKeyPublic {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ('read' | 'write')[];
  revoked: boolean;
  lastUsedAt: number | null;
  createdAt: number;
}

export interface CreatedApiKey extends ApiKeyPublic {
  key: string;
}

export interface ImapConfigPublic {
  id: string;
  accountId: string | null;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  createdAt: number;
  updatedAt: number;
}

export interface CodeCandidate {
  code: string;
  score: number;
  context: string;
}

export interface LinkCandidate {
  url: string;
  score: number;
  label: string;
}

export interface FetchedMessage {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  text: string;
  html: string | null;
  codes: CodeCandidate[];
  links: LinkCandidate[];
}

/** A 总邮件库 message: same as a fetched message, tagged with the alias it reached. */
export interface LibraryMessage extends FetchedMessage {
  alias: string;
  accountId: string;
}

export interface AutoCreateLogPublic {
  id: string;
  accountId: string;
  appleId: string | null;
  success: boolean;
  createdCount: number;
  errorCount: number;
  message: string | null;
  createdAt: number;
}

export interface OverviewPublic {
  accounts: {
    total: number;
    active: number;
    needsAttention: number;
    withImap: number;
    paused: number;
  };
  aliases: {
    total: number;
    active: number;
    used: number;
    marked: number;
  };
  setup: {
    hasAccount: boolean;
    hasActiveAccount: boolean;
    hasMailbox: boolean;
  };
  jobs: {
    sessionRefreshMinutes: number;
    markScanMinutes: number;
  };
}

export type LoginOutcome =
  { accountId: string; status: 'active' } | { accountId: string; status: 'awaiting_code'; phone: string };

export type CodeOutcome =
  { accountId: string; status: 'active' } | { accountId: string; status: 'awaiting_code'; message: string };
