import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Avatar, Form, Input } from 'antd';
import axios from 'axios';
import './ProfilePage.css';
import { api, errorMessage } from '../api/client';
import { expireSession } from '../auth/session';
import { useAuth } from '../auth/useAuth';
import { useResource } from '../hooks/useResource';
import { RequestError } from '../components/PageFeedback';
import { ManagementPageHeading } from '../components/ManagementPageHeading';
import { ProfilePermissions } from '../components/ProfilePermissions';
import { formatTime, passwordRules, trimInput } from '../utils/format';

interface PasswordFields {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function ProfilePage() {
  const { message } = App.useApp();
  const { user, updateUser } = useAuth();
  const [profile] = Form.useForm<{ email: string }>();
  const [password] = Form.useForm<PasswordFields>();
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);
  const load = useCallback((signal: AbortSignal) => api.users.me(signal), []);
  const { data, loading, error, refresh } = useResource(load);
  useEffect(() => {
    if (data) profile.setFieldsValue({ email: data.email });
  }, [data, profile]);

  async function saveProfile(values: { email: string }) {
    setSaving(true);
    try {
      const user = await api.users.update({ email: values.email });
      updateUser(user);
      profile.setFieldsValue({ email: user.email });
      void message.success('个人资料已更新');
      refresh();
    } catch (cause) {
      if (axios.isAxiosError(cause) && cause.response?.status === 409)
        profile.setFields([{ name: 'email', errors: ['邮箱已被使用'] }]);
      else if (!axios.isAxiosError(cause) || cause.response?.status !== 401)
        void message.error(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(values: PasswordFields) {
    setChanging(true);
    try {
      await api.users.changePassword({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      password.resetFields();
      expireSession('passwordChanged');
    } catch (cause) {
      if (axios.isAxiosError(cause) && cause.response?.status === 401) return;
      const text = errorMessage(cause);
      if (text === '原密码错误')
        password.setFields([{ name: 'oldPassword', errors: [text] }]);
      else if (text === '新密码不得与原密码相同')
        password.setFields([{ name: 'newPassword', errors: [text] }]);
      else void message.error(text);
    } finally {
      setChanging(false);
    }
  }

  return (
    <div className="profile-page">
      <ManagementPageHeading
        eyebrow="PERSONAL CENTER"
        title="个人中心"
        description="维护个人资料和登录密码"
      />
      {error && <RequestError error={error} retry={refresh} />}
      <div className="profile-cards">
        <Card
          className="catalog-card profile-card"
          title="个人资料"
          loading={loading}
        >
          {data && (
            <>
              <div className="profile-identity">
                <Avatar className="profile-avatar" size={56}>
                  {Array.from(data.username)[0]?.toUpperCase()}
                </Avatar>
                <div className="profile-identity-copy">
                  <div className="profile-username">{data.username}</div>
                  <div className="profile-times">
                    <span>创建时间：{formatTime(data.createdAt)}</span>
                    <span className="profile-time-divider" aria-hidden="true">
                      |
                    </span>
                    <span>更新时间：{formatTime(data.updatedAt)}</span>
                  </div>
                </div>
              </div>
              <Form
                className="profile-form"
                form={profile}
                layout="vertical"
                onFinish={saveProfile}
                disabled={saving}
              >
                <Form.Item
                  name="email"
                  label="邮箱地址"
                  normalize={trimInput}
                  rules={[
                    { required: true, message: '请输入邮箱' },
                    { type: 'email', message: '请输入有效邮箱' },
                    { max: 254, message: '邮箱最多 254 个字符' },
                  ]}
                >
                  <Input autoComplete="email" maxLength={254} />
                </Form.Item>
                <Button
                  className="profile-submit"
                  type="primary"
                  htmlType="submit"
                  loading={saving}
                >
                  保存资料
                </Button>
              </Form>
            </>
          )}
        </Card>
        <ProfilePermissions user={user} />
        <Card className="catalog-card profile-card" title="安全设置">
          <Alert
            type="info"
            showIcon
            className="profile-security-notice"
            title="修改成功后，当前及其他所有会话均需重新登录"
          />
          <Form
            className="profile-form"
            form={password}
            layout="vertical"
            onFinish={changePassword}
            disabled={changing}
          >
            <Form.Item name="oldPassword" label="原密码" rules={passwordRules}>
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Form.Item
              name="newPassword"
              label="新密码"
              dependencies={['oldPassword']}
              extra="8~32个字符，至少包含英文字母和数字"
              rules={[
                ...passwordRules,
                { max: 32, message: '新密码最多 32 个字符' },
                {
                  pattern: /^(?=[\s\S]*[A-Za-z])(?=[\s\S]*[0-9])[\s\S]+$/,
                  message: '新密码至少包含英文字母和数字',
                },
                ({ getFieldValue }) => ({
                  validator: (_rule, value: unknown) =>
                    typeof value === 'string' &&
                    value &&
                    value === getFieldValue('oldPassword')
                      ? Promise.reject(new Error('新密码不得与原密码相同'))
                      : Promise.resolve(),
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator: (_rule, value: unknown) =>
                    !value || value === getFieldValue('newPassword')
                      ? Promise.resolve()
                      : Promise.reject(new Error('两次输入的新密码不一致')),
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Button
              className="profile-submit"
              type="primary"
              htmlType="submit"
              loading={changing}
            >
              修改密码并重新登录
            </Button>
          </Form>
        </Card>
      </div>
    </div>
  );
}
