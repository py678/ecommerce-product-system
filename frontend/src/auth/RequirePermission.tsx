import { Button, Result } from 'antd';
import { Link, Outlet } from 'react-router-dom';
import type { Permission } from '../api/types';
import { useAuth } from './useAuth';
import { can } from './permissions';
export function RequirePermission({ permission }: { permission: Permission }) {
  const { user } = useAuth();
  return can(user, permission) ? (
    <Outlet />
  ) : (
    <Result
      status="403"
      title="没有访问权限"
      subTitle="当前账号无法访问此页面。"
      extra={
        <Link to="/profile">
          <Button>返回个人中心</Button>
        </Link>
      }
    />
  );
}
