export type AliasBatchInput = { ok: true; count: number; label: string } | { ok: false; message: string };

export function parseAliasBatchInput(countValue: string, labelValue: string): AliasBatchInput {
  const count = Number(countValue);
  const label = labelValue.trim();
  if (!Number.isInteger(count) || count < 1 || count > 25) {
    return { ok: false, message: '创建数量必须是 1–25 的整数' };
  }
  if (!label) return { ok: false, message: '请填写别名标签' };
  if (label.length > 120) return { ok: false, message: '别名标签不能超过 120 个字符' };
  return { ok: true, count, label };
}
