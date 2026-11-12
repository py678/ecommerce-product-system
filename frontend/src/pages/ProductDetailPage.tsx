import { useRealtimeEvent } from '../realtime/useRealtimeEvent';
import { useRealtimeRefresh } from '../realtime/useRealtimeRefresh';
import axios from 'axios';
import { useCallback, useState } from 'react';
import {
  App,
  Button,
  Card,
  Descriptions,
  Popconfirm,
  Space,
  Tag,
  Tabs,
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { can, canManageProduct } from '../auth/permissions';
import { StockMovements } from '../components/StockMovements';
import { useAuth } from '../auth/useAuth';
import { useResource } from '../hooks/useResource';
import { LoadingScreen, RequestError } from '../components/PageFeedback';
import { ProductFormModal } from '../components/ProductFormModal';
import { ProductStatusAction } from '../components/ProductStatusAction';
import { ProductStatusTag } from '../components/ProductStatusTag';
import { formatMoney, formatTime } from '../utils/format';

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const load = useCallback(
    (signal: AbortSignal) =>
      api.products.get(id, signal).catch((cause: unknown) => {
        if (
          !signal.aborted &&
          axios.isAxiosError(cause) &&
          cause.response?.status === 404
        ) {
          void message.info('商品已删除或不可访问');
          navigate('/products', { replace: true });
        }
        throw cause;
      }),
    [id, message, navigate],
  );
  const { data: product, loading, error, refresh } = useResource(load);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useRealtimeRefresh(refresh, {
    products: true,
    categories: true,
    paused: editing,
  });
  useRealtimeEvent('product:changed', (event) => {
    if (event.id === id && event.operation === 'deleted') {
      void message.info('商品已删除');
      navigate('/products', { replace: true });
    }
  });

  if (loading && !product) return <LoadingScreen />;
  if (error || !product)
    return (
      <>
        <Link to="/products">← 返回商品列表</Link>
        <RequestError error={error ?? '商品不存在'} retry={refresh} />
      </>
    );
  const owned = product.userId === user?.id;
  const editable = canManageProduct(user, product.userId, 'product:update');
  const removable = canManageProduct(user, product.userId, 'product:delete');

  async function remove() {
    if (!product) return;
    setDeleting(true);
    try {
      await api.products.remove(product.id);
      void message.success('商品已删除');
      navigate('/products', { replace: true });
    } catch (cause) {
      void message.error(errorMessage(cause));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Link className="back-link" to="/products">
        <ArrowLeftOutlined /> 返回商品列表
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PRODUCT DETAILS</span>
          <h1>{product.name}</h1>
          <p>商品详情与库存信息</p>
        </div>
        <Space>
          {editable && (
            <ProductStatusAction product={product} onChanged={refresh} />
          )}
          {editable && (
            <Button
              size="large"
              icon={<EditOutlined />}
              disabled={!editable}
              onClick={() => setEditing(true)}
            >
              编辑商品
            </Button>
          )}
          {removable && (
            <Popconfirm
              title="确认删除商品？"
              description="删除后无法恢复。"
              okText="删除"
              cancelText="取消"
              onConfirm={remove}
              disabled={!removable}
            >
              <Button
                size="large"
                danger
                icon={<DeleteOutlined />}
                disabled={!removable}
                loading={deleting}
              >
                删除商品
              </Button>
            </Popconfirm>
          )}
        </Space>
      </div>
      <div className="detail-metrics">
        <Card>
          <span className="muted">商品售价</span>
          <strong>{formatMoney(product.price)}</strong>
        </Card>
        <Card>
          <span className="muted">当前库存</span>
          <strong>
            {product.stock}
            <small> 件</small>
          </strong>
        </Card>
        <Card>
          <span className="muted">所属分类</span>
          <strong className="category-value">{product.category.name}</strong>
        </Card>
      </div>
      <Card title="商品信息" className="detail-card">
        <Descriptions
          column={{ xs: 1, sm: 2 }}
          items={[
            { key: 'name', label: '商品名称', children: product.name },
            {
              key: 'status',
              label: '上下架状态',
              children: <ProductStatusTag status={product.status} />,
            },
            {
              key: 'owner',
              label: '创建者',
              children: (
                <Space>
                  {product.user.username}
                  {owned && <Tag color="green">我</Tag>}
                </Space>
              ),
            },
            {
              key: 'created',
              label: '创建时间',
              children: formatTime(product.createdAt),
            },
            {
              key: 'updated',
              label: '更新时间',
              children: formatTime(product.updatedAt),
            },
            {
              key: 'id',
              label: '商品编号',
              span: 2,
              children: <span className="record-id">{product.id}</span>,
            },
            {
              key: 'description',
              label: '商品描述',
              span: 2,
              children: (
                <div className="product-description">
                  {product.description || '暂无描述'}
                </div>
              ),
            },
          ]}
        />
      </Card>
      {can(user, 'stock:read') &&
        (owned || user?.dataScopes?.['stock:read'] === 'ALL') && (
          <Card className="detail-card">
            <Tabs
              items={[
                {
                  key: 'stock',
                  label: '库存流水',
                  children: (
                    <StockMovements key={product.id} productId={product.id} />
                  ),
                },
              ]}
            />
          </Card>
        )}
      {!editable && (
        <p className="muted ownership-note">
          当前账号仅可查看商品，无法编辑或删除。
        </p>
      )}
      {editing && (
        <ProductFormModal
          product={product}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
    </>
  );
}
