import { useCallback, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { api, errorMessage } from '../api/client';
import type {
  ListQuery,
  PermissionDefinition,
  Role,
  RoleGrant,
  RoleInput,
} from '../api/types';
import { useAuth } from '../auth/useAuth';
import { can } from '../auth/permissions';
import { useResource } from '../hooks/useResource';
import { RequestError } from '../components/PageFeedback';
import { formatTime } from '../utils/format';

function RoleEditor({
  target,
  catalog,
  onCancel,
  onSaved,
}: {
  target: Role | null;
  catalog: PermissionDefinition[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<RoleInput & { enabled: boolean }>();
  const [grants, setGrants] = useState<RoleGrant[]>(target?.grants ?? []);
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  const modules = [...new Set(catalog.map((p) => p.module))];
  async function save(values: RoleInput & { enabled: boolean }) {
    setSaving(true);
    try {
      const input = {
        name: values.name.trim(),
        description: values.description ?? '',
        grants,
      };
      if (target)
        await api.roles.update(target.id, {
          ...input,
          enabled: values.enabled,
          version: target.version,
        });
      else await api.roles.create({ ...input, code: values.code });
      void message.success(
        target
          ? '角色已更新，关联账号需重新登录'
          : '角色已创建，可前往账号管理分配',
      );
      onSaved();
    } catch (e) {
      void message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      width={760}
      title={target ? '编辑角色' : '新增角色'}
      okText="保存角色"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={saving}
      closable={!saving}
      mask={{ closable: !saving }}
      cancelButtonProps={{ disabled: saving }}
    >
      <Alert
        type="info"
        showIcon
        title="权限按操作生效。修改角色将使其所有账号下线；不能授予超过自己权限或范围的能力。"
        style={{ marginBottom: 20 }}
      />
      <Form
        form={form}
        layout="vertical"
        disabled={saving}
        initialValues={target ?? { enabled: true, description: '' }}
        onFinish={save}
      >
        <Form.Item
          label="角色编码"
          name="code"
          rules={[
            { required: true, message: '请输入角色编码' },
            {
              pattern: /^[A-Z][A-Z0-9_]{1,31}$/,
              message: '2～32 位大写字母、数字或下划线，以字母开头',
            },
          ]}
        >
          <Input disabled={!!target} maxLength={32} />
        </Form.Item>
        <Form.Item
          label="角色名称"
          name="name"
          rules={[
            { required: true, whitespace: true, message: '请输入角色名称' },
            { max: 80 },
          ]}
        >
          <Input maxLength={80} />
        </Form.Item>
        <Form.Item label="说明" name="description" rules={[{ max: 500 }]}>
          <Input.TextArea maxLength={500} />
        </Form.Item>
        {target && (
          <Form.Item label="启用角色" name="enabled" valuePropName="checked">
            <Switch disabled={target.system} />
          </Form.Item>
        )}
        <p>权限与数据范围（不选权限时仅可使用个人中心）</p>
        <p className="muted">
          操作权限需要对应查看权限；创建商品需要查看分类，创建订单需要查看商品。全部数据写权限需要全部数据查看范围。
        </p>
        {modules.map((module) => (
          <Card
            key={module}
            size="small"
            title={module}
            style={{ marginBottom: 12 }}
          >
            {catalog
              .filter((p) => p.module === module)
              .map((p) => {
                const grant = grants.find((g) => g.permission === p.code);
                return (
                  <div
                    key={p.code}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      marginBottom: 10,
                    }}
                  >
                    <Checkbox
                      checked={!!grant}
                      onChange={(e) =>
                        setGrants(
                          e.target.checked
                            ? [
                                ...grants,
                                {
                                  permission: p.code,
                                  scope: p.scoped ? 'OWN' : 'ALL',
                                },
                              ]
                            : grants.filter((g) => g.permission !== p.code),
                        )
                      }
                    >
                      {p.name} <span className="muted">{p.code}</span>
                    </Checkbox>
                    {p.scoped && (
                      <Select
                        aria-label={p.name + '数据范围'}
                        virtual={false}
                        disabled={!grant || saving}
                        value={grant?.scope ?? 'OWN'}
                        style={{ width: 140, flexShrink: 0 }}
                        options={[
                          { value: 'OWN', label: '仅本人' },
                          { value: 'ALL', label: '全部数据' },
                        ]}
                        onChange={(scope) =>
                          setGrants(
                            grants.map((g) =>
                              g.permission === p.code ? { ...g, scope } : g,
                            ),
                          )
                        }
                      />
                    )}
                  </div>
                );
              })}
          </Card>
        ))}
      </Form>
    </Modal>
  );
}
function RoleAudits({ role, onClose }: { role: Role; onClose: () => void }) {
  const [query, setQuery] = useState<ListQuery>({ page: 1, pageSize: 10 });
  const load = useCallback(
    (signal: AbortSignal) => api.roles.audits(role.id, query, signal),
    [role.id, query],
  );
  const { data, loading, error, refresh } = useResource(load);
  return (
    <Drawer
      open
      width={800}
      title={role.name + ' · 操作审计'}
      onClose={onClose}
    >
      {error && <RequestError error={error} retry={refresh} />}
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data?.items ?? []}
        columns={[
          { title: '时间', dataIndex: 'createdAt', render: formatTime },
          { title: '操作', dataIndex: 'action' },
          { title: '操作人 ID', dataIndex: 'actorId' },
        ]}
        expandable={{
          expandedRowRender: (r) => (
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify({ before: r.before, after: r.after }, null, 2)}
            </pre>
          ),
        }}
        pagination={{
          current: query.page,
          pageSize: query.pageSize,
          total: data?.total ?? 0,
          onChange: (page) => setQuery({ ...query, page }),
        }}
      />
    </Drawer>
  );
}
export function RolesPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [query, setQuery] = useState<ListQuery>({ page: 1, pageSize: 20 });
  const [editor, setEditor] = useState<{ target: Role | null } | null>(null);
  const [audit, setAudit] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const load = useCallback(
    (signal: AbortSignal) => api.roles.list(query, signal),
    [query],
  );
  const loadCatalog = useCallback(
    (signal: AbortSignal) => api.roles.catalog(signal),
    [],
  );
  const { data, loading, error, refresh } = useResource(load);
  const {
    data: catalog,
    loading: catalogLoading,
    error: catalogError,
    refresh: refreshCatalog,
  } = useResource(loadCatalog);
  async function remove(role: Role) {
    setDeleting(role.id);
    try {
      await api.roles.remove(role.id);
      void message.success('角色已删除，审计记录保留');
      refresh();
    } catch (e) {
      void message.error(errorMessage(e));
    } finally {
      setDeleting(null);
    }
  }
  const columns: TableColumnsType<Role> = [
    { title: '角色名称', dataIndex: 'name' },
    { title: '编码', dataIndex: 'code' },
    {
      title: '状态',
      render: (_, r) => (
        <Space>
          <Tag color={r.enabled ? 'green' : 'default'}>
            {r.enabled ? '启用' : '停用'}
          </Tag>
          {r.system && <Tag>系统预置</Tag>}
        </Space>
      ),
    },
    { title: '账号数', dataIndex: 'userCount' },
    { title: '权限数', render: (_, r) => r.grants.length },
    {
      title: '操作',
      render: (_, r) => (
        <Space wrap>
          {can(user, 'role:update') && (
            <Button
              type="link"
              disabled={
                r.code === 'ADMIN' ||
                r.id === user?.roleId ||
                !catalog ||
                !!catalogError
              }
              onClick={() => setEditor({ target: r })}
            >
              编辑
            </Button>
          )}
          <Button type="link" onClick={() => setAudit(r)}>
            审计
          </Button>
          {can(user, 'role:delete') && !r.system && (
            <Popconfirm
              title="删除该角色？审计记录会保留。"
              onConfirm={() => remove(r)}
            >
              <Button
                type="link"
                danger
                disabled={r.userCount > 0 || r.id === user?.roleId}
                loading={deleting === r.id}
              >
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>角色管理</h1>
          <p>先定义角色与权限，再在账号管理中将用户分配到角色。</p>
        </div>
        {can(user, 'role:create') && (
          <Button
            type="primary"
            loading={catalogLoading}
            disabled={!catalog || !!catalogError}
            onClick={() => setEditor({ target: null })}
          >
            新增角色
          </Button>
        )}
      </div>
      <Card className="catalog-card">
        <Space wrap style={{ marginBottom: 20 }}>
          <Input.Search
            aria-label="搜索角色"
            placeholder="搜索角色名称或编码"
            maxLength={100}
            onSearch={(search) =>
              setQuery({
                ...query,
                page: 1,
                search: search.trim() || undefined,
              })
            }
            enterButton="搜索"
            allowClear
          />
          <Button onClick={refresh} loading={loading}>
            刷新
          </Button>
        </Space>
        {error && <RequestError error={error} retry={refresh} />}
        {catalogError && (
          <RequestError error={catalogError} retry={refreshCatalog} />
        )}
        <Table<Role>
          rowKey="id"
          loading={loading}
          dataSource={error ? [] : (data?.items ?? [])}
          columns={columns}
          scroll={{ x: 850 }}
          locale={{ emptyText: <Empty description="没有找到角色" /> }}
          expandable={{
            expandedRowRender: (r) => (
              <>
                <p>{r.description || '暂无说明'}</p>
                <Space wrap>
                  {r.grants.map((g) => (
                    <Tag key={g.permission}>
                      {catalog?.find((p) => p.code === g.permission)?.name ??
                        g.permission}
                      ：{g.scope === 'ALL' ? '全部数据' : '仅本人'}
                    </Tag>
                  ))}
                </Space>
              </>
            ),
          }}
          pagination={{
            current: query.page,
            pageSize: query.pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            onChange: (page, pageSize) =>
              setQuery({
                ...query,
                page: pageSize === query.pageSize ? page : 1,
                pageSize,
              }),
          }}
        />
      </Card>
      {editor && catalog && (
        <RoleEditor
          key={editor.target?.id ?? 'new'}
          target={editor.target}
          catalog={catalog}
          onCancel={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
          }}
        />
      )}
      {audit && <RoleAudits role={audit} onClose={() => setAudit(null)} />}
    </>
  );
}
