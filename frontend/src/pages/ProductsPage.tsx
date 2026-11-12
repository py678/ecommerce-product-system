import { useRealtimeRefresh } from '../realtime/useRealtimeRefresh';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Empty,
  Form,
  Popconfirm,
  Space,
  Table,
  Tag,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  AppstoreOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import type { ProductListQuery, Product } from '../api/types';
import { can, canManageProduct } from '../auth/permissions';
import { useAuth } from '../auth/useAuth';
import { useResource } from '../hooks/useResource';
import { ProductListFilters } from '../components/ProductListFilters';
import { readProductQuery, productQueryErrors } from './product-list-query';
import { RequestError } from '../components/PageFeedback';
import { ProductFormModal } from '../components/ProductFormModal';
import { ProductStatusAction } from '../components/ProductStatusAction';
import { ProductStatusTag } from '../components/ProductStatusTag';
import { ManagementPageHeading } from '../components/ManagementPageHeading';
import { formatMoney, formatTime } from '../utils/format';

export function ProductsPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => readProductQuery(params), [params]);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  function setQuery(next: ProductListQuery) {
    const updated = new URLSearchParams(params);
    updated.delete('search');
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') updated.delete(key);
      else updated.set(key, String(value));
    }
    setParams(updated);
  }
  const invalid = Object.keys(productQueryErrors(query)).length > 0;
  const debouncing = query !== debouncedQuery;
  const [modal, setModal] = useState<{ product?: Product } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const load = useCallback(
    (signal: AbortSignal) => {
      if (Object.keys(productQueryErrors(debouncedQuery)).length)
        return Promise.resolve({
          list: [],
          items: [],
          total: 0,
          page: debouncedQuery.page,
          pageSize: debouncedQuery.pageSize,
          totalPages: 0,
          lowStockThreshold: 6,
        });
      const name = debouncedQuery.name?.trim();
      return api.products.list({ ...debouncedQuery, name }, signal);
    },
    [debouncedQuery],
  );
  const { data, loading, error, refresh } = useResource(load);
  useRealtimeRefresh(refresh, {
    products: true,
    categories: true,
    paused: !!modal || debouncing,
  });

  async function remove(product: Product) {
    setDeleting(product.id);
    try {
      await api.products.remove(product.id);
      void message.success('商品已删除');
      if (data?.list.length === 1 && query.page > 1)
        setQuery({ ...query, page: query.page - 1 });
      else refresh();
    } catch (cause) {
      void message.error(errorMessage(cause));
    } finally {
      setDeleting(null);
    }
  }

  const columns: TableColumnsType<Product> = [
    {
      title: '商品',
      dataIndex: 'name',
      key: 'name',
      width: 260,
      render: (name: string, item) => (
        <div className="product-cell">
          <span className="product-symbol">
            <AppstoreOutlined />
          </span>
          <div>
            <Link className="product-name" to={`/products/${item.id}`}>
              {name}
            </Link>
            <span className="cell-secondary">
              {item.description ? item.description.slice(0, 44) : '暂无描述'}
            </span>
          </div>
        </div>
      ),
    },
    {
      title: '分类',
      key: 'category',
      width: 145,
      render: (_value, item) => (
        <Tag className="category-tag" title={item.category.name}>
          {item.category.name}
        </Tag>
      ),
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      width: 150,
      render: (value: string) => (
        <span className="money">{formatMoney(value)}</span>
      ),
    },
    {
      title: '库存',
      dataIndex: 'stock',
      key: 'stock',
      width: 110,
      render: (stock: number) => (
        <Tag
          color={
            stock === 0
              ? 'error'
              : stock < (data?.lowStockThreshold ?? 6)
                ? 'warning'
                : 'success'
          }
        >
          {stock === 0 ? '缺货' : `${stock} 件`}
        </Tag>
      ),
    },
    {
      title: '上下架状态',
      key: 'status',
      width: 110,
      render: (_value, item) => <ProductStatusTag status={item.status} />,
    },
    {
      title: '所属用户',
      key: 'user',
      width: 140,
      render: (_value, item) => (
        <span>
          {item.user.username}
          {item.userId === user?.id && <span className="own-label">我</span>}
        </span>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 175,
      render: (value: string) => (
        <span className="muted">{formatTime(value)}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 230,
      render: (_value, item) => {
        const editable = canManageProduct(user, item.userId, 'product:update');
        const removable = canManageProduct(user, item.userId, 'product:delete');
        return (
          <Space size={2}>
            <Link to={`/products/${item.id}`}>详情</Link>
            {editable && (
              <ProductStatusAction
                product={item}
                compact
                onChanged={() => {
                  if (data?.list.length === 1 && query.page > 1 && query.status)
                    setQuery({ ...query, page: query.page - 1 });
                  else refresh();
                }}
              />
            )}
            {editable && (
              <Button
                type="link"
                size="small"
                disabled={!editable}
                onClick={() => setModal({ product: item })}
              >
                编辑
              </Button>
            )}
            {removable && (
              <Popconfirm
                title="确认删除商品？"
                description="删除后无法恢复。"
                okText="删除"
                cancelText="取消"
                disabled={!removable || !!deleting}
                onConfirm={() => remove(item)}
              >
                <Button
                  type="link"
                  size="small"
                  danger
                  disabled={!removable || !!deleting}
                  loading={deleting === item.id}
                >
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <ManagementPageHeading
        eyebrow="PRODUCT CATALOG"
        title="商品管理"
        description={
          user?.dataScopes?.['product:update'] === 'ALL'
            ? '查看并管理所有成员的商品。'
            : '查看全部商品，仅可编辑和删除自己创建的商品。'
        }
        action={
          can(user, 'product:create') && (
            <Button
              type="primary"
              size="large"
              icon={<PlusOutlined />}
              onClick={() => setModal({})}
            >
              新建商品
            </Button>
          )
        }
      />
      <Card className="catalog-card">
        <div className="list-toolbar product-list-toolbar">
          <ProductListFilters
            query={query}
            onChange={(patch) => setQuery({ ...query, ...patch, page: 1 })}
          />
          <Form.Item
            className="product-filter-refresh"
            label={<span aria-hidden="true">&nbsp;</span>}
            colon={false}
          >
            <Button
              aria-label="刷新"
              icon={<ReloadOutlined />}
              onClick={refresh}
              loading={loading}
            >
              刷新
            </Button>
          </Form.Item>
        </div>
        {error && <RequestError error={error} retry={refresh} />}
        <div className="list-summary">
          商品目录 <span>{data?.total ?? '—'} 件商品</span>
        </div>
        <Table<Product>
          rowKey="id"
          columns={columns}
          dataSource={error || invalid ? [] : (data?.list ?? [])}
          loading={loading || debouncing}
          scroll={{ x: 1320 }}
          locale={{
            emptyText: (
              <Empty
                description={
                  invalid
                    ? '请先修正筛选条件'
                    : error
                      ? '商品加载失败，请重试'
                      : query.name ||
                          query.categoryId ||
                          query.minPrice ||
                          query.maxPrice ||
                          query.stockStatus ||
                          query.status
                        ? '没有找到符合条件的商品'
                        : '暂无可访问的商品'
                }
              />
            ),
          }}
          pagination={{
            current: query.page,
            pageSize: query.pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `共 ${total} 件`,
            onChange: (page, pageSize) =>
              setQuery({
                ...query,
                page: pageSize === query.pageSize ? page : 1,
                pageSize,
              }),
          }}
        />
      </Card>
      {modal && (
        <ProductFormModal
          product={modal.product}
          onCancel={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
