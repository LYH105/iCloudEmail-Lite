import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ApiKeyPublic } from '../types';
import { Badge, Button, Field, PageHeader, errorMessage, formatDate, useToast } from '../ui';

export function ApiKeysPage() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKeyPublic[]>([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<('read' | 'write')[]>(['read', 'write']);
  const [created, setCreated] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setKeys((await api.listApiKeys()).apiKeys);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const toggleScope = (s: 'read' | 'write') =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const create = async () => {
    if (!name.trim() || scopes.length === 0) return;
    try {
      const { apiKey } = await api.createApiKey(name.trim(), scopes);
      setCreated(apiKey.key);
      setName('');
      toast.ok('已创建 API Key');
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="API Key" description="供外部脚本 / 自动化调用管理台接口时使用的鉴权密钥。" />

      <div className="card p-4 flex flex-col gap-3">
        <div className="font-semibold">创建 Key</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <Field label="名称">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-script" />
            </Field>
          </div>
          {(['read', 'write'] as const).map((s) => (
            <button
              key={s}
              className={`btn btn-sm ${scopes.includes(s) ? 'btn-tinted' : 'btn-gray'}`}
              onClick={() => toggleScope(s)}
            >
              {s}
            </button>
          ))}
          <Button onClick={create} disabled={!name.trim() || scopes.length === 0}>
            创建
          </Button>
        </div>
        {created && (
          <div>
            <p className="muted text-[13px] mb-1">新 Key（仅显示一次）：</p>
            <div className="input mono break-all">{created}</div>
          </div>
        )}
      </div>

      {keys.length === 0 ? (
        <div className="card p-10 text-center muted">尚无 API Key</div>
      ) : (
        <div className="list">
          {keys.map((k) => (
            <div key={k.id} className="list-row">
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{k.name}</div>
                <div className="muted text-[13px] mono">
                  {k.keyPrefix}… · {k.scopes.join(', ')} ·{' '}
                  {k.lastUsedAt ? `最后使用 ${formatDate(k.lastUsedAt)}` : '未使用'}
                </div>
              </div>
              <Badge tone={k.revoked ? 'gray' : 'green'} dot>
                {k.revoked ? '已吊销' : '有效'}
              </Badge>
              <div className="flex gap-2">
                {!k.revoked && (
                  <Button
                    variant="gray"
                    size="sm"
                    onClick={() => api.revokeApiKey(k.id).then(refresh).catch((e) => toast.error(errorMessage(e)))}
                  >
                    吊销
                  </Button>
                )}
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => api.deleteApiKey(k.id).then(refresh).catch((e) => toast.error(errorMessage(e)))}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
