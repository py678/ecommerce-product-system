import { useCallback, useState } from 'react';
import {
  App,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  AppstoreOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import type { ListQuery, Product } from '../api/types';
import { useAuth } from '../auth/useAuth';
import { useResource } from '../hooks/useResource';
import { CategorySelect } from '../components/CategorySelect';
import { RequestError } from '../components/PageFeedback';
import { ProductFormModal } from '../components/ProductFormModal';
import { formatMoney, formatTime } from '../utils/format';

export function ProductsPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [query, setQuery] = useState<ListQuery>({ page: 1, pageSize: 20 });
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ product?: Product } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const load = useCallback(
    (signal: AbortSignal) => api.products.list(query, signal),
    [query],
  );
  const { data, loading, error, refresh } = useResource(load);

  async function remove(product: Product) {
    setDeleting(product.id);
    try {
      await api.products.remove(product.id);
      void message.success('商品已删除');
      if (data?.items.length === 1 && query.page > 1)
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
        <Tag color={stock === 0 ? 'error' : stock <= 5 ? 'warning' : 'success'}>
          {stock === 0 ? '缺货' : `${stock} 件`}
        </Tag>
      ),
    },
    {
      title: '创建者',
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
      width: 180,
      render: (_value, item) => {
        const owned = item.userId === user?.id;
        return (
          <Space size={2}>
            <Link to={`/products/${item.id}`}>详情</Link>
            <Tooltip title={owned ? undefined : '仅创建者可编辑'}>
              <Button
                type="link"
                size="small"
                disabled={!owned}
                onClick={() => setModal({ product: item })}
              >
                编辑
              </Button>
            </Tooltip>
            <Popconfirm
              title="确认删除商品？"
              description="删除后无法恢复。"
              okText="删除"
              cancelText="取消"
              disabled={!owned || !!deleting}
              onConfirm={() => remove(item)}
            >
              <Button
                type="link"
                size="small"
                danger
                disabled={!owned || !!deleting}
                loading={deleting === item.id}
              >
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PRODUCT CATALOG</span>
          <h1>商品管理</h1>
          <p>查看全部商品，管理自己创建的商品。</p>
        </div>
        <Button
          type="primary"
          size="large"
          icon={<PlusOutlined />}
          onClick={() => setModal({})}
        >
          新建商品
        </Button>
      </div>
      <Card className="catalog-card">
        <div className="list-toolbar">
          <div className="list-filters">
            <Input.Search
              aria-label="搜索商品"
              placeholder="搜索商品名称"
              value={search}
              maxLength={100}
              allowClear
              onChange={(event) => setSearch(event.target.value)}
              onSearch={(value) =>
                setQuery({
                  ...query,
                  page: 1,
                  search: value.trim() || undefined,
                })
              }
              enterButton="搜索"
            />
            <CategorySelect
              value={query.categoryId}
              allowClear
              placeholder="全部分类"
              onChange={(categoryId) =>
                setQuery({ ...query, page: 1, categoryId })
              }
            />
          </div>
          <Button
            aria-label="刷新"
            icon={<ReloadOutlined />}
            onClick={refresh}
            loading={loading}
          >
            刷新
          </Button>
        </div>
        {error && <RequestError error={error} retry={refresh} />}
        <div className="list-summary">
          商品目录 <span>{data?.total ?? '—'} 件商品</span>
        </div>
        <Table<Product>
          rowKey="id"
          columns={columns}
          dataSource={data?.items ?? []}
          loading={loading}
          scroll={{ x: 1160 }}
          locale={{
            emptyText: (
              <Empty
                description={
                  query.search || query.categoryId
                    ? '没有找到符合条件的商品'
                    : '还没有商品，先创建一件吧'
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
