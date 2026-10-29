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
import { useAuth } from './auth/useAuth';
import { AdminLayout } from './layouts/AdminLayout';
import { LoadingScreen } from './components/PageFeedback';

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
            <Route index element={<Navigate to="/products" replace />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/products/:id" element={<ProductDetailPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
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
