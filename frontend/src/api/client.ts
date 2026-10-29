import axios from 'axios';
import { sessionToken, SESSION_EXPIRED_EVENT } from '../auth/session';
import type {
  AuthResponse,
  Category,
  ListQuery,
  Page,
  Product,
  ProductInput,
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
        sessionToken.set(null);
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      }
    }
    return Promise.reject(error);
  },
);

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
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
  auth: {
    register: async (input: {
      username: string;
      email: string;
      password: string;
    }) => (await http.post<AuthResponse>('/auth/register', input)).data,
    login: async (input: { username: string; password: string }) =>
      (await http.post<AuthResponse>('/auth/login', input)).data,
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
    list: async (params: ListQuery, signal?: AbortSignal) =>
      (await http.get<Page<Product>>('/products', { params, signal })).data,
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
