import { useCallback, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { api, errorMessage } from '../api/client';
import type { AdminUserQuery, User, RoleOption } from '../api/types';
import { useAuth } from '../auth/useAuth';
import { can, roleLabel } from '../auth/permissions';
import { RequestError } from '../components/PageFeedback';
import { useResource } from '../hooks/useResource';
import { formatTime } from '../utils/format';
function RoleModal({
  target,
  roles,
  onCancel,
  onSaved,
}: {
  target: User;
  roles: RoleOption[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<{ roleId: string }>();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  async function save(values: { roleId: string }) {
    setSaving(true);
    try {
      await api.adminUsers.assignRole(target.id, values.roleId);
      void message.success('角色已更新，该账号需重新登录');
      onSaved();
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      title="确认调整账号角色"
      okText="确认修改并使旧会话失效"
      cancelText="取消"
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={onCancel}
      closable={!saving}
      mask={{ closable: !saving }}
      cancelButtonProps={{ disabled: saving }}
    >
      <p>目标账号：{target.username}</p>
      <Alert
        type="warning"
        showIcon
        title="修改成功后，该账号当前及其他会话均需重新登录。"
      />
      <Form
        form={form}
        layout="vertical"
        disabled={saving}
        initialValues={{ roleId: target.roleId }}
        onFinish={save}
      >
        <Form.Item
          name="roleId"
          label="角色"
          rules={[
            { required: true, message: '请选择角色' },
            {
              validator: (_rule, value: unknown) =>
                value === target.roleId
                  ? Promise.reject(new Error('请选择不同的角色'))
                  : Promise.resolve(),
            },
          ]}
        >
          <Select
            virtual={false}
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
export function AdminUsersPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState<AdminUserQuery>({ page: 1, pageSize: 20 });
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<User | null>(null);
  const load = useCallback(
    (signal: AbortSignal) => api.adminUsers.list(query, signal),
    [query],
  );
  const { data, loading, error, refresh } = useResource(load);
  const loadRoles = useCallback(
    (signal: AbortSignal) => api.roles.options(signal),
    [],
  );
  const {
    data: roles = [],
    loading: rolesLoading,
    error: rolesError,
    refresh: refreshRoles,
  } = useResource(loadRoles);
  const columns: TableColumnsType<User> = [
    { title: '用户名', dataIndex: 'username' },
    { title: '邮箱', dataIndex: 'email' },
    {
      title: '角色',
      key: 'role',
      render: (_value, item) => (
        <Tag
          color={
            item.role === 'ADMIN'
              ? 'gold'
              : item.role === 'OPERATOR'
                ? 'green'
                : 'default'
          }
        >
          {roleLabel(item)}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: (value: string) => formatTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_value, item) =>
        can(user, 'user:assign-role') && (
          <Button
            type="link"
            disabled={item.id === user?.id}
            onClick={() => setTarget(item)}
          >
            {item.id === user?.id ? '当前账号' : '调整角色'}
          </Button>
        ),
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>账号管理</h1>
          <p>将账号分配到已定义的角色，变更后该账号需要重新登录。</p>
        </div>
      </div>
      <Card className="catalog-card">
        <Space wrap style={{ marginBottom: 20 }}>
          <Input.Search
            aria-label="搜索账号"
            placeholder="搜索用户名或邮箱"
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(value) =>
              setQuery({ ...query, page: 1, search: value.trim() || undefined })
            }
            allowClear
            enterButton="搜索"
          />
          <Select
            virtual={false}
            aria-label="角色筛选"
            placeholder="全部角色"
            style={{ width: 160 }}
            allowClear
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
            loading={rolesLoading}
            value={query.roleId}
            onChange={(roleId: string | undefined) =>
              setQuery({ ...query, page: 1, roleId })
            }
          />
          <Button onClick={refresh} loading={loading}>
            刷新
          </Button>
        </Space>
        {rolesError && <RequestError error={rolesError} retry={refreshRoles} />}
        {error && <RequestError error={error} retry={refresh} />}
        <Table<User>
          rowKey="id"
          columns={columns}
          dataSource={error ? [] : (data?.items ?? [])}
          loading={loading}
          scroll={{ x: 900 }}
          locale={{ emptyText: <Empty description="没有找到符合条件的账号" /> }}
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
      {target && (
        <RoleModal
          target={target}
          roles={roles}
          onCancel={() => setTarget(null)}
          onSaved={() => {
            setTarget(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
