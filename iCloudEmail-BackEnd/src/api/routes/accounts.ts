import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireScope } from '../auth.js';
import { notFound, parse } from '../errors.js';
import * as accounts from '../../services/accountService.js';

const loginSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  appleId: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
  china: z.boolean().default(true),
  rememberPassword: z.boolean().default(true),
});
const retryLoginSchema = z.object({
  password: z.string().min(1).max(200).optional(),
  china: z.boolean().optional(),
  rememberPassword: z.boolean().default(true),
});
const codeSchema = z.object({ code: z.string().min(1).max(20) });
const imapSchema = z.object({
  password: z.string().min(1),
  username: z.string().min(1).optional(),
});
const settingsSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  imapPassword: z.string().min(1).optional(),
  imapUsername: z.string().min(1).optional(),
  autoCreateEnabled: z.boolean().optional(),
  clearLoginPassword: z.boolean().optional(),
});
const disabledSchema = z.object({ disabled: z.boolean() });
const openPageSchema = z.object({
  url: z
    .string()
    .url()
    .refine((raw) => {
      try {
        const { protocol, hostname } = new URL(raw);
        return (
          protocol === 'https:' &&
          ['apple.com', 'icloud.com', 'icloud.com.cn'].some(
            (d) => hostname === d || hostname.endsWith(`.${d}`),
          )
        );
      } catch {
        return false;
      }
    }, '仅允许打开 Apple / iCloud 域名的 https 页面')
    .optional(),
});

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [authenticate, requireScope('read')] };
  const write = { preHandler: [authenticate, requireScope('write')] };

  app.get('/', read, async () => ({ accounts: accounts.listAccounts() }));

  app.get<{ Params: { id: string } }>('/:id', read, async (req) => {
    const account = accounts.getAccount(req.params.id);
    if (!account) throw notFound('账户不存在');
    return { account };
  });

  // Password login (SRP-6a, no browser). A fresh client is never pre-trusted
  // by Apple, so this always returns 'awaiting_code' — the UI follows up
  // with POST /:id/verify-code once the user reads the SMS.
  app.post('/login', write, async (req) => {
    const input = parse(loginSchema, req.body ?? {});
    return accounts.startLogin(input);
  });

  // Re-run login for an existing account: silently with the stored password
  // + trust token (no body needed), or with a freshly typed password (e.g.
  // after an Apple ID password change).
  app.post<{ Params: { id: string } }>('/:id/relogin', write, async (req) => {
    const input = parse(retryLoginSchema, req.body ?? {});
    return accounts.retryLogin(req.params.id, input);
  });

  app.post<{ Params: { id: string } }>('/:id/resume-code', write, async (req) =>
    accounts.resumeCode(req.params.id),
  );

  app.post<{ Params: { id: string } }>('/:id/resend-code', write, async (req) =>
    accounts.resendCode(req.params.id),
  );

  app.post<{ Params: { id: string } }>('/:id/verify-code', write, async (req) => {
    const { code } = parse(codeSchema, req.body);
    return accounts.submitCode(req.params.id, code);
  });

  app.delete<{ Params: { id: string } }>('/:id', write, async (req) => {
    const deleted = accounts.deleteAccount(req.params.id);
    if (!deleted) throw notFound('账户不存在');
    return { deleted: true };
  });

  // One-shot save from the account editor: label + IMAP app-specific password.
  app.post<{ Params: { id: string } }>('/:id/settings', write, async (req) => {
    const input = parse(settingsSchema, req.body ?? {});
    return { account: accounts.updateSettings(req.params.id, input) };
  });

  // Pause / resume an account (excluded from the mail library + all background
  // jobs while disabled).
  app.post<{ Params: { id: string } }>('/:id/disabled', write, async (req) => {
    const { disabled } = parse(disabledSchema, req.body ?? {});
    return { account: accounts.setDisabled(req.params.id, disabled) };
  });

  // Open a visible browser window on the account's signed-in profile
  // (default: Apple ID management, to create an App-specific password).
  app.post<{ Params: { id: string } }>('/:id/open-page', write, async (req) => {
    const { url } = parse(openPageSchema, req.body ?? {});
    return accounts.openAccountPage(req.params.id, url);
  });

  // Cookie-only recovery of an expired session (headless profile refresh).
  app.post<{ Params: { id: string } }>('/:id/recover', write, async (req) =>
    accounts.recoverSession(req.params.id),
  );

  // Set / clear / test the account's app-specific mail password (IMAP).
  app.post<{ Params: { id: string } }>('/:id/imap', write, async (req) => {
    const { password, username } = parse(imapSchema, req.body);
    accounts.setImapPassword(req.params.id, password, username);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/:id/imap', write, async (req) => {
    accounts.clearImapPassword(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/:id/imap/test', write, async (req) =>
    accounts.testImap(req.params.id),
  );
}
