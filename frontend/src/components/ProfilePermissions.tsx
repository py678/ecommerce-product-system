import { Card, Tag } from 'antd';
import type { Permission, User } from '../api/types';
import { roleLabel } from '../auth/permissions';

type ScopeKind = 'resource' | 'shared' | 'create' | 'global' | 'admin';
const catalog: Record<Permission, [string, string, ScopeKind]> = {
  'product:read': ['商品管理', '查看商品', 'resource'],
  'product:create': ['商品管理', '创建商品', 'create'],
  'product:update': ['商品管理', '修改商品', 'resource'],
  'product:delete': ['商品管理', '删除商品', 'resource'],
  'stock:read': ['库存流水', '查看库存流水', 'resource'],
  'order:read': ['订单管理', '查看订单', 'resource'],
  'order:create': ['订单管理', '创建订单', 'create'],
  'order:confirm': ['订单管理', '确认订单', 'resource'],
  'order:ship': ['订单管理', '订单发货', 'resource'],
  'order:complete': ['订单管理', '完成订单', 'resource'],
  'order:cancel': ['订单管理', '取消订单', 'resource'],
  'category:read': ['分类管理', '查看分类', 'shared'],
  'category:create': ['分类管理', '创建分类', 'shared'],
  'category:update': ['分类管理', '修改分类', 'shared'],
  'category:delete': ['分类管理', '删除分类', 'shared'],
  'upload:image': ['图片上传', '上传图片', 'global'],
  'user:read': ['账号管理', '查看账号', 'global'],
  'user:assign-role': ['账号管理', '分配账号角色', 'global'],
  'user:delete': ['账号管理', '软删除账号', 'global'],
  'user:restore': ['账号管理', '恢复账号', 'global'],
  'user:purge': ['账号管理', '彻底删除账号', 'admin'],
  'role:read': ['角色管理', '查看角色', 'global'],
  'role:create': ['角色管理', '创建角色', 'global'],
  'role:update': ['角色管理', '修改角色', 'global'],
  'role:delete': ['角色管理', '删除角色', 'global'],
};

function scopeLabel(user: User, permission: Permission, kind: ScopeKind) {
  if (kind === 'create') return '创建后归本人';
  if (kind === 'shared') return '全局共享';
  if (kind === 'global') return '已授权';
  if (kind === 'admin') return '仅系统管理员可执行';
  return user.dataScopes?.[permission] === 'ALL'
    ? '全部数据'
    : user.dataScopes?.[permission] === 'OWN'
      ? '仅本人'
      : '范围未配置，请联系管理员';
}

export function ProfilePermissions({ user }: { user: User | null }) {
  const granted = new Set(user?.permissions ?? []);
  const modules = [
    ...new Set(Object.values(catalog).map(([module]) => module)),
  ];
  return (
    <Card
      className="catalog-card profile-card"
      title="角色与权限"
      role="region"
      aria-label="角色与权限"
      loading={!user}
    >
      {user && (
        <>
          <div className="profile-role-summary">
            <span className="muted">当前角色</span>
            <strong>{roleLabel(user) || '未分配角色'}</strong>
            <Tag>{user.role}</Tag>
            <p>仅供查看，权限调整请联系管理员。</p>
            <p>
              “仅本人”按商品或订单创建者判断，库存流水按商品创建者判断；上下架使用“修改商品”权限。
            </p>
            <p>已授权操作仍受订单状态、业务关联和系统角色保护等规则限制。</p>
          </div>
          <div className="profile-permission-groups">
            {granted.size === 0 ? (
              <p className="muted">当前角色未授予业务权限，可使用个人中心。</p>
            ) : (
              modules.map((module) => {
                const entries = (
                  Object.entries(catalog) as [
                    Permission,
                    [string, string, ScopeKind],
                  ][]
                ).filter(
                  ([permission, [group]]) =>
                    group === module && granted.has(permission),
                );
                return entries.length > 0 ? (
                  <section key={module} aria-label={module}>
                    <h3>{module}</h3>
                    <div className="profile-permission-tags">
                      {entries.map(([permission, [, label, kind]]) => (
                        <Tag key={permission} title={permission}>
                          {label}：{scopeLabel(user, permission, kind)}
                        </Tag>
                      ))}
                    </div>
                  </section>
                ) : null;
              })
            )}
          </div>
        </>
      )}
    </Card>
  );
}
