import { useState } from 'react';
import { Alert, App, Button, Form, Input, Radio } from 'antd';
import { ArrowRightOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import type { UserRole } from '../api/types';
import { ROLE_LABELS, homePath } from '../auth/permissions';
import { useAuth } from '../auth/useAuth';
import { LoadingScreen } from '../components/PageFeedback';
import { passwordRules, trimInput, usernameRules } from '../utils/format';

interface AuthFields {
  username: string;
  email: string;
  password: string;
  confirm: string;
  loginRole: UserRole;
  role: UserRole;
  companyId?: string;
}

export function AuthPage({ register = false }: { register?: boolean }) {
  const { user, loading, error, notice, signIn } = useAuth();
  const { message } = App.useApp();
  const location = useLocation();
  const [form] = Form.useForm<AuthFields>();
  const registrationRole = Form.useWatch('role', form) ?? 'OPERATOR';
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const from: unknown = location.state?.from;
  const destination =
    typeof from === 'string' &&
    (from.startsWith('/products') ||
      from.startsWith('/categories') ||
      from === '/profile' ||
      from.startsWith('/admin/') ||
      from.startsWith('/orders'))
      ? from
      : homePath(user);

  if (loading) return <LoadingScreen />;
  if (user) return <Navigate to={destination} replace />;

  async function submit(values: AuthFields) {
    setSaving(true);
    setSubmitError(null);
    try {
      const response = register
        ? await api.auth.register({
            username: values.username,
            email: values.email,
            password: values.password,
            role: values.role,
            ...(values.role === 'ADMIN' ? { companyId: values.companyId } : {}),
          })
        : await api.auth.login({
            username: values.username,
            password: values.password,
            loginRole: values.loginRole,
          });
      signIn(response);
      void message.success(register ? '注册成功，欢迎使用' : '登录成功');
    } catch (cause) {
      setSubmitError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-intro">
        <Link className="brand" to="/login">
          <span className="brand-mark">S</span>
          <span>
            SILK<span className="brand-caption">商品管理工作台</span>
          </span>
        </Link>
        <div className="auth-intro-copy">
          <span className="eyebrow">LESS CLUTTER. MORE CLARITY.</span>
          <h1>
            管理商品，
            <br />
            从容有序。
          </h1>
          <p>
            从商品上架到分类维护，
            <br />
            把日常管理集中在一个清晰的工作台。
          </p>
          <div className="intro-features">
            <span>
              <CheckCircleOutlined /> 商品与库存一目了然
            </span>
            <span>
              <CheckCircleOutlined /> 分类清晰，协作有序
            </span>
          </div>
        </div>
        <span className="auth-footer">SILK · YOUR EVERYDAY WORKSPACE</span>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">
            {register ? 'CREATE YOUR ACCOUNT' : 'WELCOME BACK'}
          </span>
          <h2>{register ? '创建账号' : '欢迎回来'}</h2>
          <p className="muted">
            {register
              ? '选择注册身份；注册管理员需验证公司内部 ID。'
              : '登录账号，继续今天的管理工作。'}
          </p>
          {(submitError || notice || error) && (
            <Alert
              className="auth-alert"
              showIcon
              type={submitError || error ? 'error' : 'warning'}
              title={submitError || notice || error}
            />
          )}
          <Form<AuthFields>
            key={register ? 'register' : 'login'}
            layout="vertical"
            form={form}
            initialValues={{ loginRole: 'OPERATOR', role: 'OPERATOR' }}
            size="large"
            requiredMark={false}
            onFinish={submit}
            disabled={saving}
          >
            <Form.Item
              label={register ? '注册身份' : '登录身份'}
              name={register ? 'role' : 'loginRole'}
              rules={[{ required: true, message: '请选择登录身份' }]}
            >
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                block
                options={Object.entries(ROLE_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Form.Item>
            {register && registrationRole === 'ADMIN' && (
              <Form.Item
                label="公司内部 ID"
                name="companyId"
                preserve={false}
                rules={[
                  { required: true, message: '请输入公司内部 ID' },
                  { max: 128, message: '公司内部 ID 过长' },
                ]}
              >
                <Input.Password
                  autoComplete="off"
                  placeholder="请输入公司内部 ID"
                  maxLength={128}
                />
              </Form.Item>
            )}
            {!register && (
              <p className="muted">
                请选择账号已有角色，登录入口不会改变账号权限。
              </p>
            )}
            <Form.Item
              label="用户名"
              name="username"
              normalize={trimInput}
              rules={usernameRules}
            >
              <Input
                autoComplete="username"
                placeholder="请输入用户名"
                maxLength={64}
              />
            </Form.Item>
            {register && (
              <Form.Item
                label="邮箱"
                name="email"
                normalize={trimInput}
                rules={[
                  { required: true, message: '请输入邮箱' },
                  { type: 'email', message: '请输入有效的邮箱地址' },
                  { max: 254, message: '邮箱过长' },
                ]}
              >
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                />
              </Form.Item>
            )}
            <Form.Item label="密码" name="password" rules={passwordRules}>
              <Input.Password
                autoComplete={register ? 'new-password' : 'current-password'}
                placeholder="至少 8 个字符"
              />
            </Form.Item>
            {register && (
              <Form.Item
                label="确认密码"
                name="confirm"
                dependencies={['password']}
                rules={[
                  { required: true, message: '请再次输入密码' },
                  ({ getFieldValue }) => ({
                    validator: (_rule, value: unknown) =>
                      value === getFieldValue('password')
                        ? Promise.resolve()
                        : Promise.reject(new Error('两次输入的密码不一致')),
                  }),
                ]}
              >
                <Input.Password
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                />
              </Form.Item>
            )}
            <Button
              className="auth-submit"
              type="primary"
              htmlType="submit"
              block
              loading={saving}
              icon={<ArrowRightOutlined />}
              iconPlacement="end"
            >
              {register ? '注册并进入工作台' : '登录工作台'}
            </Button>
          </Form>
          <div className="auth-switch">
            {register ? '已有账号？' : '还没有账号？'}
            <Link to={register ? '/login' : '/register'} state={location.state}>
              {register ? '立即登录' : '创建账号'}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
