import { useCallback, useState } from 'react';
import {
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  FolderOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import type { Category, ListQuery } from '../api/types';
import { useResource } from '../hooks/useResource';
import { RequestError } from '../components/PageFeedback';
import { formatTime, trimInput } from '../utils/format';

function CategoryModal({
  category,
  onCancel,
  onSaved,
}: {
  category?: Category;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<{ name: string }>();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  async function save(values: { name: string }) {
    setSaving(true);
    try {
      if (category) await api.categories.update(category.id, values);
      else await api.categories.create(values);
      void message.success(category ? '分类已更新' : '分类已创建');
      onSaved();
    } catch (cause) {
      void message.error(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      title={category ? '编辑分类' : '新建分类'}
      okText={category ? '保存修改' : '创建分类'}
      cancelText="取消"
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={onCancel}
      closable={!saving}
      mask={{ closable: !saving }}
      cancelButtonProps={{ disabled: saving }}
    >
      <p className="muted">分类由所有成员共享，用于整理和筛选商品。</p>
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={saving}
        initialValues={{ name: category?.name ?? '' }}
        onFinish={save}
      >
        <Form.Item
          label="分类名称"
          name="name"
          normalize={trimInput}
          rules={[
            { required: true, message: '请输入分类名称' },
            { max: 120, message: '分类名称最多 120 个字符' },
          ]}
        >
          <Input placeholder="例如：数码配件" maxLength={120} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function CategoriesPage() {
  const { message } = App.useApp();
  const [query, setQuery] = useState<ListQuery>({ page: 1, pageSize: 20 });
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ category?: Category } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const load = useCallback(
    (signal: AbortSignal) => api.categories.list(query, signal),
    [query],
  );
  const { data, loading, error, refresh } = useResource(load);

  async function remove(category: Category) {
    setDeleting(category.id);
    try {
      await api.categories.remove(category.id);
      void message.success('分类已删除');
      if (data?.items.length === 1 && query.page > 1)
        setQuery({ ...query, page: query.page - 1 });
      else refresh();
    } catch (cause) {
      void message.error(errorMessage(cause));
      refresh();
    } finally {
      setDeleting(null);
    }
  }

  const columns: TableColumnsType<Category> = [
    {
      title: '分类名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <Space size={12}>
          <span className="folder-symbol">
            <FolderOutlined />
          </span>
          <span className="product-name">{name}</span>
        </Space>
      ),
    },
    {
      title: '关联商品',
      dataIndex: 'productCount',
      key: 'productCount',
      width: 160,
      render: (count: number) => <Tag>{count} 件商品</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 190,
      render: (value: string) => (
        <span className="muted">{formatTime(value)}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 155,
      render: (_value, item) => (
        <Space size={2}>
          <Button
            type="link"
            size="small"
            onClick={() => setModal({ category: item })}
          >
            编辑
          </Button>
          <Tooltip
            title={item.productCount ? '请先调整或删除分类下的商品' : undefined}
          >
            <Popconfirm
              title="确认删除分类？"
              okText="删除"
              cancelText="取消"
              disabled={!!item.productCount || !!deleting}
              onConfirm={() => remove(item)}
            >
              <Button
                type="link"
                size="small"
                danger
                disabled={!!item.productCount || !!deleting}
                loading={deleting === item.id}
              >
                删除
              </Button>
            </Popconfirm>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">KEEP THINGS ORGANIZED</span>
          <h1>分类管理</h1>
          <p>整理共享分类，让商品更容易被找到。</p>
        </div>
        <Button
          type="primary"
          size="large"
          icon={<PlusOutlined />}
          onClick={() => setModal({})}
        >
          新建分类
        </Button>
      </div>
      <Card className="catalog-card">
        <div className="list-toolbar">
          <Input.Search
            className="category-search"
            aria-label="搜索分类"
            placeholder="搜索分类名称"
            value={search}
            maxLength={100}
            allowClear
            onChange={(event) => setSearch(event.target.value)}
            onSearch={(value) =>
              setQuery({ ...query, page: 1, search: value.trim() || undefined })
            }
            enterButton="搜索"
          />
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
          分类目录 <span>{data?.total ?? '—'} 个分类</span>
        </div>
        <Table<Category>
          rowKey="id"
          columns={columns}
          dataSource={data?.items ?? []}
          loading={loading}
          scroll={{ x: 780 }}
          locale={{
            emptyText: (
              <Empty
                description={
                  query.search
                    ? '没有找到符合条件的分类'
                    : '还没有分类，先创建一个吧'
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
            showTotal: (total) => `共 ${total} 个`,
            onChange: (page, pageSize) =>
              setQuery({
                ...query,
                page: pageSize === query.pageSize ? page : 1,
                pageSize,
              }),
          }}
        />
        <div className="table-hint">
          有商品引用的分类需要先移出商品，才能删除。
          <Link to="/products">前往商品管理 →</Link>
        </div>
      </Card>
      {modal && (
        <CategoryModal
          category={modal.category}
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
