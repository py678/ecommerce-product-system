import { useCallback, useState } from 'react';
import { Alert, App, Form, Input, Modal } from 'antd';
import { api, errorMessage } from '../api/client';
import type { AdminUser } from '../api/types';
import { useResource } from '../hooks/useResource';
import { RequestError } from './PageFeedback';

export type AccountAction = 'delete' | 'restore' | 'purge';
const labels = { delete: '软删除', restore: '恢复', purge: '彻底删除' };
export function AccountActionModal({
  target,
  action,
  onCancel,
  onSaved,
}: {
  target: AdminUser;
  action: AccountAction;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<{ reason: string; username?: string }>();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  const load = useCallback(
    (signal: AbortSignal) =>
      action === 'purge'
        ? api.adminUsers.dependencies(target.id, signal)
        : Promise.resolve(null),
    [action, target.id],
  );
  const { data, loading, error, refresh } = useResource(load);
  const blocked = action === 'purge' && (loading || !!error || !data?.canPurge);
  async function save(values: { reason: string; username?: string }) {
    if (blocked || saving) return;
    setSaving(true);
    try {
      const reason = values.reason.trim();
      if (action === 'purge')
        await api.adminUsers.purge(target.id, {
          username: values.username!,
          reason,
        });
      else
        await api.adminUsers[action === 'delete' ? 'remove' : 'restore'](
          target.id,
          reason,
        );
      void message.success(
        action === 'restore'
          ? '账号已恢复，请通知对方重新登录'
          : `账号已${labels[action]}`,
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
      title={`${labels[action]}账号：${target.username}`}
      okText={`确认${labels[action]}`}
      cancelText="取消"
      okButtonProps={{ danger: action !== 'restore', disabled: blocked }}
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={onCancel}
      closable={!saving}
      mask={{ closable: !saving }}
      cancelButtonProps={{ disabled: saving }}
    >
      <Alert
        showIcon
        type={action === 'purge' ? 'error' : 'warning'}
        title={
          action === 'delete'
            ? '保留商品与订单，账号立即下线并禁止登录；可从回收站恢复。'
            : action === 'restore'
              ? '恢复原角色，但所有旧会话继续失效；角色已停用时仍无法登录。'
              : '彻底删除不可恢复；仅允许清理没有商品和任何状态订单的回收站账号。'
        }
      />
      {action === 'purge' && (
        <>
          {loading && <p>正在检查关联数据…</p>}
          {error && <RequestError error={error} retry={refresh} />}
          {data && (
            <p>
              商品：{data.productCount}；订单（全部状态）：{data.orderCount}
            </p>
          )}
          {data && !data.canPurge && (
            <Alert
              type="error"
              title="账号仍有关联数据或状态已变化，不能彻底删除。"
            />
          )}
        </>
      )}
      <Form
        form={form}
        layout="vertical"
        disabled={saving}
        onFinish={save}
        style={{ marginTop: 20 }}
      >
        {action === 'purge' && (
          <Form.Item
            label="确认用户名"
            name="username"
            rules={[
              { required: true, message: '请输入目标用户名' },
              {
                validator: (_rule, value: unknown) =>
                  value === target.username
                    ? Promise.resolve()
                    : Promise.reject(new Error('用户名不匹配')),
              },
            ]}
          >
            <Input
              autoComplete="off"
              maxLength={64}
              placeholder={target.username}
            />
          </Form.Item>
        )}
        <Form.Item
          label="操作原因"
          name="reason"
          rules={[
            { required: true, whitespace: true, message: '请填写操作原因' },
            { max: 500, message: '操作原因最多500个字符' },
          ]}
        >
          <Input.TextArea
            rows={3}
            maxLength={500}
            showCount
            placeholder="请勿填写密码或令牌"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
