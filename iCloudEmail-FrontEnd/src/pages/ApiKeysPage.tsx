import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ApiKeyPublic } from '../types';
import { Badge, Button, Field, PageHeader, Sheet, errorMessage, formatDate, useToast } from '../ui';

export function ApiKeysPage() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKeyPublic[]>([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<('read' | 'write')[]>(['read', 'write']);
  const [created, setCreated] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ApiKeyPublic | null>(null);

  const refresh = async () => {
    try {
      setKeys((await api.listApiKeys()).apiKeys);
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const toggleScope = (scope: 'read' | 'write') =>
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );

  const create = async () => {
    if (!name.trim() || scopes.length === 0) return;
    setCreating(true);
    try {
      const { apiKey } = await api.createApiKey(name.trim(), scopes);
      setCreated(apiKey.key);
      setName('');
      toast.ok('API 密钥已创建');
      await refresh();
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (key: ApiKeyPublic) => {
    setBusyId(key.id);
    try {
      await api.revokeApiKey(key.id);
      toast.ok('密钥已吊销');
      await refresh();
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setBusyId(confirmDelete.id);
    try {
      await api.deleteApiKey(confirmDelete.id);
      toast.ok('密钥记录已删除');
      setConfirmDelete(null);
      await refresh();
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusyId(null);
    }
  };

  const copyCreated = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      toast.ok('完整密钥已复制');
    } catch {
      toast.error('复制失败，请手动选择密钥');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="API 密钥"
        description="仅在浏览器/脚本模式下使用。桌面应用默认只在本机运行，不需要配置密钥。"
      />

      <section className="panel api-key-create">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">外部访问</span>
            <h3>创建新密钥</h3>
          </div>
        </div>
        <form
          className="api-key-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="flex-1 min-w-[180px]">
            <Field label="名称">
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：本机脚本"
              />
            </Field>
          </div>
          <div>
            <span className="field-label">权限</span>
            <div className="flex gap-2">
              {(['read', 'write'] as const).map((scope) => (
                <button
                  type="button"
                  key={scope}
                  className={`btn btn-sm ${scopes.includes(scope) ? 'btn-tinted' : 'btn-gray'}`}
                  aria-pressed={scopes.includes(scope)}
                  onClick={() => toggleScope(scope)}
                >
                  {scope === 'read' ? '读取' : '写入'}
                </button>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={creating || !name.trim() || scopes.length === 0}>
            {creating ? '创建中…' : '创建密钥'}
          </Button>
        </form>

        {created && (
          <div className="created-key" role="status">
            <div>
              <strong>完整密钥仅显示一次</strong>
              <span>请立即保存到密码管理器。</span>
            </div>
            <code>{created}</code>
            <Button size="sm" onClick={() => void copyCreated()}>
              复制
            </Button>
          </div>
        )}
      </section>

      {keys.length === 0 ? (
        <div className="card p-10 text-center muted">还没有 API 密钥</div>
      ) : (
        <div className="list">
          {keys.map((key) => (
            <div key={key.id} className="list-row">
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{key.name}</div>
                <div className="muted text-[12px] mono mt-1">
                  {key.keyPrefix}… ·{' '}
                  {key.scopes.map((scope) => (scope === 'read' ? '读取' : '写入')).join(' / ')}
                </div>
                <div className="subtle text-[10px] mt-1">
                  {key.lastUsedAt ? `最后使用于 ${formatDate(key.lastUsedAt)}` : '尚未使用'}
                </div>
              </div>
              <Badge tone={key.revoked ? 'gray' : 'green'} dot>
                {key.revoked ? '已吊销' : '有效'}
              </Badge>
              <div className="flex gap-2">
                {!key.revoked && (
                  <Button
                    variant="gray"
                    size="sm"
                    disabled={busyId === key.id}
                    onClick={() => void revoke(key)}
                  >
                    吊销
                  </Button>
                )}
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busyId === key.id}
                  onClick={() => setConfirmDelete(key)}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <Sheet
          title="删除 API 密钥记录？"
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <Button className="flex-1" variant="gray" onClick={() => setConfirmDelete(null)}>
                取消
              </Button>
              <Button
                className="flex-1"
                variant="danger"
                disabled={busyId === confirmDelete.id}
                onClick={() => void remove()}
              >
                {busyId === confirmDelete.id ? '删除中…' : '确认删除'}
              </Button>
            </>
          }
        >
          <p className="muted text-[13px] leading-6">
            将永久移除“{confirmDelete.name}”的记录。若它仍有效，使用该密钥的脚本会立即失去访问权限。
          </p>
        </Sheet>
      )}
    </div>
  );
}
