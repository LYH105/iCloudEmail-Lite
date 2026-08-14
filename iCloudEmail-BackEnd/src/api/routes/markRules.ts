import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireScope } from '../auth.js';
import { parse } from '../errors.js';
import * as marks from '../../services/markService.js';

const ruleSchema = z.object({
  mark: z.string().min(1).max(40),
  fromContains: z.string().max(300).nullable().optional(),
  subjectContains: z.string().max(300).nullable().optional(),
  bodyContains: z.string().max(300).nullable().optional(),
  enabled: z.boolean().optional(),
});
const importSchema = z.object({
  rules: z.array(ruleSchema).max(500),
});
const renameSchema = z.object({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
});

/** Mounted under /api/mark-rules — user-defined alias marking rules. */
export async function markRuleRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [authenticate, requireScope('read')] };
  const write = { preHandler: [authenticate, requireScope('write')] };

  app.get('/', read, async () => ({ rules: marks.listRules() }));

  app.post('/', write, async (req) => ({ rule: marks.createRule(parse(ruleSchema, req.body)) }));

  app.patch<{ Params: { id: string } }>('/:id', write, async (req) => ({
    rule: marks.updateRule(req.params.id, parse(ruleSchema, req.body)),
  }));

  app.delete<{ Params: { id: string } }>('/:id', write, async (req) => {
    const deleted = marks.deleteRule(req.params.id);
    if (!deleted) throw Object.assign(new Error('规则不存在'), { status: 404 });
    return { deleted: true };
  });

  // Marks left on aliases that no rule produces any more, plus the two ways to
  // resolve them: fold into the mark that replaced them, or clear them.
  app.get('/orphans', read, async () => ({ orphans: marks.listOrphanMarks() }));

  app.post('/marks/rename', write, async (req) => {
    const { from, to } = parse(renameSchema, req.body);
    return { renamed: marks.renameMark(from, to) };
  });

  app.delete<{ Params: { mark: string } }>('/marks/:mark', write, async (req) => ({
    cleared: marks.deleteMark(decodeURIComponent(req.params.mark)),
  }));

  app.get('/export', read, async () => ({ rules: marks.exportRules() }));

  app.post('/import', write, async (req) => {
    const { rules } = parse(importSchema, req.body ?? {});
    return marks.importRules(rules);
  });
}
