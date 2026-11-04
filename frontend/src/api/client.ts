import axios from 'axios';
import { sessionToken, expireSession } from '../auth/session';
import type {
  AuthResponse,
  AdminUserQuery,
  UserRole,
  ImageUploadResponse,
  Category,
  ListQuery,
  Page,
  Product,
  ProductInput,
  ProductListQuery,
  ProductPage,
  User,
} from './types';

const http = axios.create({ baseURL: '/api', timeout: 15000 });

http.interceptors.request.use((config) => {
  const token = sessionToken.get();
  if (
    token &&
    config.url !== '/auth/login' &&
    config.url !== '/auth/register'
  ) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const token = sessionToken.get();
      // Ignore late responses belonging to a previous session and public login failures.
      if (
        token &&
        error.config?.headers.get('Authorization') === `Bearer ${token}`
      ) {
        expireSession(
          error.response.data?.message === '密码已修改，请重新登录' ||
            error.config?.url === '/users/me/password'
            ? 'passwordChanged'
            : error.response.data?.code === 'SESSION_REVOKED'
              ? 'securityChanged'
              : 'expired',
        );
      }
    }
    return Promise.reject(error);
  },
);

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 403) return '没有执行此操作的权限';
    const message: unknown = error.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message))
      return message.filter((item) => typeof item === 'string').join('；');
    if (error.code === 'ECONNABORTED') return '请求超时，请稍后重试';
    if (!error.response) return '无法连接服务器，请检查网络后重试';
  }
  return '操作未完成，请稍后重试';
}

export const isCanceled = axios.isCancel;

export const api = {
  adminUsers: {
    list: async (params: AdminUserQuery, signal?: AbortSignal) =>
      (await http.get<Page<User>>('/admin/users', { params, signal })).data,
    assignRole: async (id: string, role: UserRole) =>
      (await http.patch<User>(`/admin/users/${id}/role`, { role })).data,
  },
  users: {
    me: async (signal?: AbortSignal) =>
      (await http.get<User>('/users/me', { signal })).data,
    update: async (input: { email: string }) =>
      (await http.patch<User>('/users/me', input)).data,
    changePassword: async (input: {
      oldPassword: string;
      newPassword: string;
    }) =>
      (await http.patch<{ message: string }>('/users/me/password', input)).data,
  },
  upload: {
    image: async (file: File, signal: AbortSignal) => {
      const form = new FormData();
      form.append('file', file);
      const response = (
        await http.post<ImageUploadResponse>('/upload/image', form, { signal })
      ).data;
      if (response.code !== 0 || typeof response.data?.url !== 'string')
        throw new Error('Invalid image upload response');
      return response;
    },
  },
  auth: {
    register: async (input: {
      username: string;
      email: string;
      password: string;
    }) => (await http.post<AuthResponse>('/auth/register', input)).data,
    login: async (input: {
      username: string;
      password: string;
      loginRole?: UserRole;
    }) => (await http.post<AuthResponse>('/auth/login', input)).data,
    me: async (signal: AbortSignal) =>
      (await http.get<User>('/auth/me', { signal })).data,
  },
  categories: {
    list: async (params: ListQuery, signal?: AbortSignal) =>
      (await http.get<Page<Category>>('/categories', { params, signal })).data,
    create: async (input: { name: string }) =>
      (await http.post<Category>('/categories', input)).data,
    update: async (id: string, input: { name: string }) =>
      (await http.patch<Category>(`/categories/${id}`, input)).data,
    remove: async (id: string) => {
      await http.delete(`/categories/${id}`);
    },
  },
  products: {
    list: async (params: ProductListQuery, signal?: AbortSignal) =>
      (await http.get<ProductPage>('/products', { params, signal })).data,
    get: async (id: string, signal: AbortSignal) =>
      (await http.get<Product>(`/products/${id}`, { signal })).data,
    create: async (input: ProductInput) =>
      (await http.post<Product>('/products', input)).data,
    update: async (id: string, input: ProductInput) =>
      (await http.patch<Product>(`/products/${id}`, input)).data,
    remove: async (id: string) => {
      await http.delete(`/products/${id}`);
    },
  },
};
