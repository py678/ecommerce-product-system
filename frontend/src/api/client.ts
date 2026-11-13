import type {
  CreateOrderInput,
  OrderDetail,
  OrderPage,
  OrderQuery,
} from '../orders/order-types';
import axios from 'axios';
import { sessionToken, expireSession } from '../auth/session';
import type {
  Role,
  StockMovementQuery,
  StockMovementPage,
  RoleInput,
  RoleOption,
  RolePage,
  PermissionDefinition,
  AuditPage,
  AuthResponse,
  AdminUserQuery,
  AdminUser,
  AccountDependencies,
  UserRole,
  ImageUploadResponse,
  Category,
  CategoryListQuery,
  ListQuery,
  Page,
  Product,
  ProductInput,
  ProductStatus,
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
  stockMovements: {
    list: async (params: StockMovementQuery, signal?: AbortSignal) =>
      (
        await http.get<StockMovementPage>('/stock-movements', {
          params,
          signal,
        })
      ).data,
    forProduct: async (
      id: string,
      params: StockMovementQuery,
      signal?: AbortSignal,
    ) =>
      (
        await http.get<StockMovementPage>(`/products/${id}/stock-movements`, {
          params,
          signal,
        })
      ).data,
    forOrder: async (
      id: string,
      params: StockMovementQuery,
      signal?: AbortSignal,
    ) =>
      (
        await http.get<StockMovementPage>(`/orders/${id}/stock-movements`, {
          params,
          signal,
        })
      ).data,
  },
  roles: {
    catalog: async (signal?: AbortSignal) =>
      (
        await http.get<PermissionDefinition[]>('/admin/roles/permissions', {
          signal,
        })
      ).data,
    options: async (signal?: AbortSignal) =>
      (await http.get<RoleOption[]>('/admin/roles/options', { signal })).data,
    list: async (params: ListQuery, signal?: AbortSignal) =>
      (await http.get<RolePage>('/admin/roles', { params, signal })).data,
    create: async (input: RoleInput) =>
      (await http.post<Role>('/admin/roles', input)).data,
    update: async (
      id: string,
      input: Partial<RoleInput> & { version: number; enabled?: boolean },
    ) => (await http.patch<Role>('/admin/roles/' + id, input)).data,
    remove: async (id: string) => {
      await http.delete('/admin/roles/' + id);
    },
    audits: async (id: string, params: ListQuery, signal?: AbortSignal) =>
      (
        await http.get<AuditPage>('/admin/roles/' + id + '/audits', {
          params,
          signal,
        })
      ).data,
  },
  orders: {
    list: async (params: OrderQuery, signal?: AbortSignal) =>
      (await http.get<OrderPage>('/orders', { params, signal })).data,
    get: async (id: string, signal?: AbortSignal) =>
      (await http.get<OrderDetail>('/orders/' + id, { signal })).data,
    create: async (input: CreateOrderInput) =>
      (await http.post<OrderDetail>('/orders', input)).data,
    action: async (
      id: string,
      action: 'confirm' | 'ship' | 'complete' | 'cancel',
      input: object,
    ) =>
      (await http.patch<OrderDetail>('/orders/' + id + '/' + action, input))
        .data,
  },
  adminUsers: {
    list: async (params: AdminUserQuery, signal?: AbortSignal) =>
      (await http.get<Page<AdminUser>>('/admin/users', { params, signal }))
        .data,
    dependencies: async (id: string, signal?: AbortSignal) =>
      (
        await http.get<AccountDependencies>(`/admin/users/${id}/dependencies`, {
          signal,
        })
      ).data,
    remove: async (id: string, reason: string) =>
      (await http.delete(`/admin/users/${id}`, { data: { reason } })).data,
    restore: async (id: string, reason: string) =>
      (await http.post(`/admin/users/${id}/restore`, { reason })).data,
    purge: async (id: string, input: { username: string; reason: string }) =>
      (await http.delete(`/admin/users/${id}/purge`, { data: input })).data,
    assignRole: async (id: string, roleId: string) =>
      (await http.patch<User>(`/admin/users/${id}/role`, { roleId })).data,
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
      role?: UserRole;
      companyId?: string;
    }) => (await http.post<AuthResponse>('/auth/register', input)).data,
    login: async (input: { username: string; password: string }) =>
      (await http.post<AuthResponse>('/auth/login', input)).data,
    me: async (signal: AbortSignal) =>
      (await http.get<User>('/auth/me', { signal })).data,
  },
  categories: {
    list: async (params: CategoryListQuery, signal?: AbortSignal) =>
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
    updateStatus: async (id: string, status: ProductStatus) =>
      (await http.patch<Product>(`/products/${id}/status`, { status })).data,
    remove: async (id: string) => {
      await http.delete(`/products/${id}`);
    },
  },
};
