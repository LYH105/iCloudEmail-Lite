import { useRef, useState } from 'react';
import { api } from '../../api';
import type { MarkRule, MarkRuleExport, OrphanMark } from '../../types';
import { errorMessage, useToast } from '../../ui';

export function useMarkRules(refreshAliases: () => Promise<void>) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<MarkRule[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [mark, setMark] = useState('');
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [orphans, setOrphans] = useState<OrphanMark[]>([]);
  const [orphanTarget, setOrphanTarget] = useState<Record<string, string>>({});
  const [orphanBusy, setOrphanBusy] = useState<string | null>(null);
  const [orphanConfirm, setOrphanConfirm] = useState<string | null>(null);

  const loadRules = async () => {
    try {
      setRules((await api.listMarkRules()).rules);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const loadOrphans = async () => {
    try {
      setOrphans((await api.listOrphanMarks()).orphans);
    } catch {
      // Orphan maintenance should not block editing the rules themselves.
    }
  };

  const resetForm = () => {
    setEditId(null);
    setMark('');
    setFrom('');
    setSubject('');
    setBody('');
  };

  const openSheet = () => {
    setOpen(true);
    resetForm();
    setOrphanConfirm(null);
    void loadRules();
    void loadOrphans();
  };

  const closeSheet = () => {
    if (!busy) setOpen(false);
  };

  const exportRules = async () => {
    try {
      const { rules: exported } = await api.exportMarkRules();
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mark-rules-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const importRulesFile = async (file: File | null) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : (parsed as { rules?: unknown }).rules;
      if (!Array.isArray(list)) throw new Error('文件格式不正确：需要规则数组');
      const result = await api.importMarkRules(list as MarkRuleExport[]);
      toast.ok(
        `已导入 ${result.imported} 条规则${
          result.skipped ? `，跳过 ${result.skipped} 条（重复或无效）` : ''
        }`,
      );
      await loadRules();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const markNames = Array.from(new Set(rules.map((rule) => rule.mark)));
  const suggestTarget = (orphanMark: string): string => {
    const lower = orphanMark.toLowerCase();
    const hits = markNames.filter(
      (candidate) => candidate !== orphanMark && candidate.toLowerCase().includes(lower),
    );
    return hits.length === 1 ? hits[0]! : '';
  };

  const mergeOrphan = async (orphan: OrphanMark) => {
    const target = orphanTarget[orphan.mark] ?? suggestTarget(orphan.mark);
    if (!target) {
      toast.error('请选择要合并到哪个标记');
      return;
    }
    setOrphanBusy(orphan.mark);
    try {
      const result = await api.renameMark(orphan.mark, target);
      toast.ok(`已把 ${result.renamed} 个别名的「${orphan.mark}」并入「${target}」`);
      await Promise.all([loadOrphans(), refreshAliases()]);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setOrphanBusy(null);
    }
  };

  const clearOrphan = async (orphan: OrphanMark) => {
    setOrphanBusy(orphan.mark);
    try {
      const result = await api.clearMark(orphan.mark);
      toast.ok(`已从 ${result.cleared} 个别名上清除「${orphan.mark}」`);
      setOrphanConfirm(null);
      await Promise.all([loadOrphans(), refreshAliases()]);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setOrphanBusy(null);
    }
  };

  const editRule = (rule: MarkRule) => {
    setEditId(rule.id);
    setMark(rule.mark);
    setFrom(rule.fromContains ?? '');
    setSubject(rule.subjectContains ?? '');
    setBody(rule.bodyContains ?? '');
  };

  const saveRule = async () => {
    const data = {
      mark: mark.trim(),
      fromContains: from.trim() || null,
      subjectContains: subject.trim() || null,
      bodyContains: body.trim() || null,
    };
    if (!data.mark) {
      toast.error('请填写标记名');
      return;
    }
    if (!data.fromContains && !data.subjectContains && !data.bodyContains) {
      toast.error('至少填写一个匹配条件（发件人/主题/正文）');
      return;
    }
    setBusy(true);
    try {
      if (editId) {
        const existing = rules.find((rule) => rule.id === editId);
        await api.updateMarkRule(editId, { ...data, enabled: existing?.enabled ?? true });
      } else {
        await api.createMarkRule(data);
      }
      toast.ok('已保存规则');
      resetForm();
      await Promise.all([loadRules(), loadOrphans(), refreshAliases()]);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleRule = async (rule: MarkRule) => {
    try {
      await api.updateMarkRule(rule.id, {
        mark: rule.mark,
        fromContains: rule.fromContains,
        subjectContains: rule.subjectContains,
        bodyContains: rule.bodyContains,
        enabled: !rule.enabled,
      });
      await loadRules();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const removeRule = async (rule: MarkRule) => {
    try {
      await api.deleteMarkRule(rule.id);
      toast.ok('已删除规则');
      if (editId === rule.id) resetForm();
      await Promise.all([loadRules(), loadOrphans()]);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return {
    open,
    rules,
    editId,
    mark,
    setMark,
    from,
    setFrom,
    subject,
    setSubject,
    body,
    setBody,
    busy,
    fileRef,
    orphans,
    orphanTarget,
    setOrphanTarget,
    orphanBusy,
    orphanConfirm,
    setOrphanConfirm,
    markNames,
    suggestTarget,
    openSheet,
    closeSheet,
    exportRules,
    importRulesFile,
    mergeOrphan,
    clearOrphan,
    editRule,
    saveRule,
    toggleRule,
    removeRule,
    resetForm,
    loadRules,
  };
}

export type MarkRulesController = ReturnType<typeof useMarkRules>;
