import { lazy, Suspense } from 'react';
import { Button, Result } from 'antd';
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { homePath } from './auth/permissions';
import { RequirePermission } from './auth/RequirePermission';
import { useAuth } from './auth/useAuth';
import { AdminLayout } from './layouts/AdminLayout';
import { LoadingScreen } from './components/PageFeedback';

const OrdersPage = lazy(() =>
  import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })),
);
const OrderCreatePage = lazy(() =>
  import('./pages/OrderCreatePage').then((m) => ({
    default: m.OrderCreatePage,
  })),
);
const OrderDetailPage = lazy(() =>
  import('./pages/OrderDetailPage').then((m) => ({
    default: m.OrderDetailPage,
  })),
);
const AuthPage = lazy(() =>
  import('./pages/AuthPage').then((module) => ({ default: module.AuthPage })),
);
const ProductsPage = lazy(() =>
  import('./pages/ProductsPage').then((module) => ({
    default: module.ProductsPage,
  })),
);
const CategoriesPage = lazy(() =>
  import('./pages/CategoriesPage').then((module) => ({
    default: module.CategoriesPage,
  })),
);
const ProductDetailPage = lazy(() =>
  import('./pages/ProductDetailPage').then((module) => ({
    default: module.ProductDetailPage,
  })),
);

const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((module) => ({
    default: module.ProfilePage,
  })),
);

const AdminUsersPage = lazy(() =>
  import('./pages/AdminUsersPage').then((module) => ({
    default: module.AdminUsersPage,
  })),
);

const RolesPage = lazy(() =>
  import('./pages/RolesPage').then((m) => ({ default: m.RolesPage })),
);
function Home() {
  const { user } = useAuth();
  return <Navigate to={homePath(user)} replace />;
}
function RequireAuth() {
  const { user, loading, error, signOut } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (error)
    return (
      <Result
        status="warning"
        title="暂时无法连接工作台"
        subTitle={error}
        extra={[
          <Button
            key="retry"
            type="primary"
            onClick={() => window.location.reload()}
          >
            重试
          </Button>,
          <Button key="logout" onClick={signOut}>
            返回登录
          </Button>,
        ]}
      />
    );
  if (!user)
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  return <Outlet />;
}

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage register />} />
        <Route element={<RequireAuth />}>
          <Route element={<AdminLayout />}>
            <Route index element={<Home />} />
            <Route element={<RequirePermission permission="product:read" />}>
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/products/:id" element={<ProductDetailPage />} />
            </Route>
            <Route element={<RequirePermission permission="category:read" />}>
              <Route path="/categories" element={<CategoriesPage />} />
            </Route>
            <Route element={<RequirePermission permission="user:read" />}>
              <Route path="/admin/users" element={<AdminUsersPage />} />
            </Route>
            <Route element={<RequirePermission permission="order:read" />}>
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/:id" element={<OrderDetailPage />} />
            </Route>
            <Route element={<RequirePermission permission="order:create" />}>
              <Route path="/orders/new" element={<OrderCreatePage />} />
            </Route>
            <Route element={<RequirePermission permission="role:read" />}>
              <Route path="/admin/roles" element={<RolesPage />} />
            </Route>
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
        </Route>
        <Route
          path="*"
          element={
            <Result
              status="404"
              title="页面不存在"
              subTitle="这个页面可能已移动，返回工作台继续操作。"
              extra={
                <Link to="/products">
                  <Button type="primary">返回工作台</Button>
                </Link>
              }
            />
          }
        />
      </Routes>
    </Suspense>
  );
}
