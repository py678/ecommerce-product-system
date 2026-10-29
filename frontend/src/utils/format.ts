export function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatMoney(value: string) {
  const [integer, decimal = '00'] = value.split('.');
  return `¥${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decimal.padEnd(2, '0')}`;
}

export const trimInput = (value: unknown) =>
  typeof value === 'string' ? value.trim() : value;

export const passwordRules = [
  { required: true, message: '请输入密码' },
  { min: 8, message: '密码至少 8 个字符' },
  {
    validator: (_rule: unknown, value: unknown) => {
      if (typeof value !== 'string' || !value) return Promise.resolve();
      if (!/\S/.test(value))
        return Promise.reject(new Error('密码不能全部为空白'));
      if (new TextEncoder().encode(value).length > 72)
        return Promise.reject(new Error('密码最多 72 字节，请减少字符数量'));
      return Promise.resolve();
    },
  },
];

export const usernameRules = [
  { required: true, message: '请输入用户名' },
  { min: 3, max: 64, message: '用户名需为 3–64 个字符' },
  {
    pattern: /^[\p{L}\p{N}_-]+$/u,
    message: '仅支持字母、数字、下划线和连字符',
  },
];
