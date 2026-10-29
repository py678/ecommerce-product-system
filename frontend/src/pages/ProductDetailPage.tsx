import { useCallback, useState } from 'react';
import { App, Button, Card, Descriptions, Popconfirm, Space, Tag } from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { useResource } from '../hooks/useResource';
import { LoadingScreen, RequestError } from '../components/PageFeedback';
import { ProductFormModal } from '../components/ProductFormModal';
import { formatMoney, formatTime } from '../utils/format';

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const load = useCallback(
    (signal: AbortSignal) => api.products.get(id, signal),
    [id],
  );
  const { data: product, loading, error, refresh } = useResource(load);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (loading) return <LoadingScreen />;
  if (error || !product)
    return (
      <>
        <Link to="/products">← 返回商品列表</Link>
        <RequestError error={error ?? '商品不存在'} retry={refresh} />
      </>
    );
  const owned = product.userId === user?.id;

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
          <Button
            size="large"
            icon={<EditOutlined />}
            disabled={!owned}
            onClick={() => setEditing(true)}
          >
            编辑商品
          </Button>
          <Popconfirm
            title="确认删除商品？"
            description="删除后无法恢复。"
            okText="删除"
            cancelText="取消"
            onConfirm={remove}
            disabled={!owned}
          >
            <Button
              size="large"
              danger
              icon={<DeleteOutlined />}
              disabled={!owned}
              loading={deleting}
            >
              删除商品
            </Button>
          </Popconfirm>
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
      {!owned && (
        <p className="muted ownership-note">
          这件商品由其他成员创建，你可以查看，编辑和删除由创建者操作。
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
