import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import type { CodeCandidate, LinkCandidate } from './types';

/* ---------------- Toasts ---------------- */
interface Toast {
  id: number;
  kind: 'ok' | 'error';
  message: string;
}
interface ToastCtx {
  ok: (m: string) => void;
  error: (m: string) => void;
}
const ToastContext = createContext<ToastCtx>({ ok: () => {}, error: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const value: ToastCtx = {
    ok: (m) => push('ok', m),
    error: (m) => push('error', m),
  };
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'ok' ? 'toast-ok' : 'toast-error'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------------- Sheet (modal) ---------------- */
export function Sheet({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // Closes only via an explicit button in `footer` — clicking the backdrop
  // no longer dismisses it, so an accidental misclick can't drop form input.
  return (
    <div className="sheet-backdrop">
      <div className="sheet">
        <h3 className="text-center text-[17px] font-semibold mb-4">{title}</h3>
        {children}
        {footer && <div className="mt-5 flex gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- Button ---------------- */
type Variant = 'filled' | 'tinted' | 'plain' | 'gray' | 'danger';
export function Button({
  variant = 'filled',
  size = 'md',
  className = '',
  ...props
}: { variant?: Variant; size?: 'md' | 'sm' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const v = `btn-${variant}`;
  const s = size === 'sm' ? 'btn-sm' : '';
  return <button className={`btn ${v} ${s} ${className}`} {...props} />;
}

/* ---------------- Segmented control ---------------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} data-active={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Sidebar navigation ---------------- */
export function Sidebar<T extends string>({
  brand,
  options,
  value,
  onChange,
  footer,
}: {
  brand: ReactNode;
  options: { value: T; label: string; icon: string }[];
  value: T;
  onChange: (v: T) => void;
  footer?: ReactNode;
}) {
  return (
    <div className="sidebar">
      <div className="sidebar-brand">{brand}</div>
      <nav className="sidebar-nav">
        {options.map((o) => (
          <button
            key={o.value}
            className="sidebar-nav-item"
            data-active={value === o.value}
            onClick={() => onChange(o.value)}
          >
            <span className="sidebar-nav-icon">{o.icon}</span>
            {o.label}
          </button>
        ))}
      </nav>
      {footer && <div className="sidebar-footer">{footer}</div>}
    </div>
  );
}

/* ---------------- Page header: title + description + actions ---------------- */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h2 className="page-header-title">{title}</h2>
        {description && <div className="page-header-desc">{description}</div>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}

/* ---------------- iOS switch ---------------- */
export function Switch({
  checked,
  onChange,
  size = 'md',
}: {
  checked: boolean;
  onChange: () => void;
  size?: 'md' | 'sm';
}) {
  return (
    <button
      className={`switch ${size === 'sm' ? 'switch-sm' : ''}`}
      data-on={checked}
      onClick={onChange}
      aria-pressed={checked}
    />
  );
}

/* ---------------- Badge ---------------- */
export function Badge({
  tone,
  dot,
  children,
}: {
  tone: 'green' | 'red' | 'amber' | 'gray';
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

/* ---------------- Field wrapper ---------------- */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

/* ---------------- Email viewer (renders original message) ---------------- */
interface ViewableMessage {
  subject: string;
  from: string;
  to?: string;
  date: string;
  html: string | null;
  text: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function EmailViewer({ message, onClose }: { message: ViewableMessage; onClose: () => void }) {
  // Close only via the button or Esc — never on an outside click, so clicking a
  // link / selecting text inside the email can't accidentally dismiss it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Render the original email in a sandboxed iframe (no scripts). `<base
  // target="_blank">` makes links open as popups; the desktop shell's
  // window-open handler routes those to the system browser.
  const inner = message.html
    ? message.html
    : `<pre style="margin:0;white-space:pre-wrap;word-break:break-word">${escapeHtml(
        message.text || '(无正文)',
      )}</pre>`;
  const doc =
    `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">` +
    `<style>html,body{margin:0}body{padding:16px;font:14px/1.7 -apple-system,'PingFang SC',sans-serif;` +
    `color:#111;background:#fff;word-break:break-word}img{max-width:100%;height:auto}a{color:#0a66ff}</style>` +
    `</head><body>${inner}</body></html>`;

  return (
    <div className="sheet-backdrop">
      <div className="sheet" style={{ maxWidth: 780, padding: 16 }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="font-semibold truncate">{message.subject || '(无主题)'}</div>
            <div className="muted text-[12px] truncate">
              {message.from}
              {message.to ? ` → ${message.to}` : ''}
            </div>
            <div className="muted text-[12px] mt-0.5">
              收件时间：{formatDate(message.date)}
            </div>
          </div>
          <Button variant="gray" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
        <iframe
          title="email"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={doc}
          className="w-full rounded-xl"
          style={{ height: '68vh', border: 'none', background: '#fff' }}
        />
      </div>
    </div>
  );
}

/* ---------------- helpers ---------------- */
export function formatDate(ts: number | string | null): string {
  // 0 / '' are "no timestamp" (fresh aliases before a sync), not 1970-01-01.
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

/**
 * Short relative time ("3 分钟前"), falling back to the absolute date past a
 * month — used where a timestamp sits next to an absolute date and the two
 * must not be visually confused.
 */
export function formatRelative(ts: number | string): string {
  const at = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (!Number.isFinite(at)) return '—';
  const diff = Date.now() - at;
  if (diff < 60_000) return '刚刚';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDate(at);
}

// Minimum extractor score for a detected code to count as a real verification
// code (keyword-adjacent or 6-digit). Below this it's likely a stray number
// (ZIP, order #…) in an otherwise normal email — show nothing.
const CODE_MIN_SCORE = 4;

/**
 * What a message should surface: a verification code, a sign-in link, or
 * neither (a normal email, or a weak false positive). Code XOR link — never
 * both; the stronger signal wins, ties going to the link.
 */
export function pickCodeOrLink(msg: { codes: CodeCandidate[]; links: LinkCandidate[] }): {
  code: CodeCandidate | null;
  link: LinkCandidate | null;
} {
  const code = msg.codes[0];
  const link = msg.links[0];
  const hasCode = !!code && code.score >= CODE_MIN_SCORE;
  const showLink = !!link && (!hasCode || link.score >= code.score);
  return { code: hasCode && !showLink ? code : null, link: showLink ? link : null };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
