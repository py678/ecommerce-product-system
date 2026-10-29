import { useState } from 'react';
import { Avatar, Button, Layout, Menu, Space, Typography } from 'antd';
import {
  AppstoreOutlined,
  FolderOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

export function AdminLayout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const section = location.pathname.startsWith('/categories')
    ? '/categories'
    : '/products';

  return (
    <Layout className="admin-layout">
      <Layout.Sider
        className="sidebar"
        width={224}
        breakpoint="lg"
        collapsedWidth={0}
        collapsed={collapsed}
        onBreakpoint={setCollapsed}
        trigger={null}
      >
        <Link className="brand" to="/products">
          <span className="brand-mark">S</span>
          <span>
            SILK<span className="brand-caption">商品管理工作台</span>
          </span>
        </Link>
        <div className="nav-caption">工作空间</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[section]}
          onClick={({ key }) => {
            navigate(key);
            if (window.matchMedia('(max-width: 991px)').matches)
              setCollapsed(true);
          }}
          items={[
            { key: '/products', icon: <AppstoreOutlined />, label: '商品管理' },
            { key: '/categories', icon: <FolderOutlined />, label: '分类管理' },
          ]}
        />
        <div className="sidebar-footer">
          <span className="status-dot" />
          让每一件商品井然有序
        </div>
      </Layout.Sider>
      <Layout className="main-layout">
        <Layout.Header className="topbar">
          <Space size={16}>
            <Button
              type="text"
              aria-label="切换导航"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
            <span className="breadcrumb">
              工作台 <span>/</span>{' '}
              {section === '/products' ? '商品管理' : '分类管理'}
            </span>
          </Space>
          <Space size={12}>
            <Avatar className="user-avatar">
              {user?.username.slice(0, 1).toUpperCase()}
            </Avatar>
            <Typography.Text className="user-name">
              {user?.username}
            </Typography.Text>
            <Button
              aria-label="退出"
              type="text"
              icon={<LogoutOutlined />}
              onClick={() => {
                signOut();
                navigate('/login', { replace: true });
              }}
            >
              退出
            </Button>
          </Space>
        </Layout.Header>
        <Layout.Content className="page-content">
          <Outlet />
        </Layout.Content>
        <Layout.Footer className="page-footer">
          SILK · 商品管理工作台
        </Layout.Footer>
      </Layout>
    </Layout>
  );
}
