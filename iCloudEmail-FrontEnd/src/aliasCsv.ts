import type { AccountPublic, AliasPublic } from './types';

const HEADERS = ['邮箱地址', '账户', '标签', '备注', '状态', '已使用', '标记', '创建时间', '转发至'];

function cell(value: unknown): string {
  let text = value == null ? '' : String(value);
  // Prevent spreadsheet formula execution when user-controlled labels or
  // notes are opened in Excel/Numbers/LibreOffice.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function iso(timestamp: number | null): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** UTF-8 BOM keeps Chinese headers readable when the CSV is opened in Excel. */
export function aliasesToCsv(
  aliases: AliasPublic[],
  accounts: Pick<AccountPublic, 'id' | 'appleId'>[],
): string {
  const accountById = new Map(accounts.map((account) => [account.id, account.appleId ?? account.id]));
  const rows = aliases.map((alias) => [
    alias.hme,
    accountById.get(alias.accountId) ?? alias.accountId,
    alias.label,
    alias.note,
    alias.isActive ? '启用' : '停用',
    alias.used ? '是' : '否',
    alias.marks.map((mark) => mark.mark).join('; '),
    iso(alias.createTimestamp),
    alias.forwardToEmail,
  ]);
  return `\uFEFF${[HEADERS, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
