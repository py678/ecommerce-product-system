import { useCallback } from 'react';
import { Button, Card, Input, Select, Space, Table, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ManagementPageHeading } from '../components/ManagementPageHeading';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useResource } from '../hooks/useResource';
import { useRealtimeRefresh } from '../realtime/useRealtimeRefresh';
import { RequestError } from '../components/PageFeedback';
import { can } from '../auth/permissions';
import { useAuth } from '../auth/useAuth';
import {
  ORDER_COLORS,
  ORDER_LABELS,
  type OrderQuery,
  type OrderStatus,
} from '../orders/order-types';

function localDate(value: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}
export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const raw = params.toString();
  const load = useCallback(
    (signal: AbortSignal) => {
      const p = new URLSearchParams(raw);
      const positive = (s: string | null, f: number, max: number) =>
        /^\d+$/.test(s ?? '') ? Math.min(max, Math.max(1, Number(s))) : f;
      const status = p.get('status');
      const query: OrderQuery = {
        page: positive(p.get('page'), 1, 2147483647),
        pageSize: positive(p.get('pageSize'), 10, 100),
        search: p.get('search') || undefined,
        status:
          status && Object.hasOwn(ORDER_LABELS, status)
            ? (status as OrderStatus)
            : undefined,
        createdFrom: p.get('createdFrom') || undefined,
        createdTo: p.get('createdTo') || undefined,
      };
      return api.orders.list(query, signal);
    },
    [raw],
  );
  const { data, loading, error, refresh } = useResource(load);
  useRealtimeRefresh(refresh, { orders: true });
  const change = (values: Record<string, string | undefined>, reset = true) => {
    const p = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) p.set(key, value);
      else p.delete(key);
    }
    if (reset) p.set('page', '1');
    setParams(p);
  };
  return (
    <div className="orders-workspace orders-list-workspace">
      <ManagementPageHeading
        eyebrow="ORDER MANAGEMENT"
        title="订单管理"
        description="代客录单、手动确认与物流跟进；运营人员仅查看自己的订单"
        action={
          can(user, 'order:create') && (
            <Link to="/orders/new">
              <Button type="primary" size="large" icon={<PlusOutlined />}>
                创建订单
              </Button>
            </Link>
          )
        }
      />
      <Card>
        <Space wrap align="end" className="order-filters">
          <Input.Search
            key={params.get('search')}
            aria-label="搜索订单"
            placeholder="订单号 / 客户姓名"
            maxLength={100}
            defaultValue={params.get('search') ?? ''}
            allowClear
            onSearch={(v) => change({ search: v.trim() || undefined })}
            style={{ width: 260 }}
          />
          <Select
            aria-label="订单状态"
            placeholder="全部状态"
            allowClear
            style={{ width: 150 }}
            value={params.get('status') || undefined}
            onChange={(v) => change({ status: v })}
            options={Object.entries(ORDER_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <label>
            开始日期{' '}
            <Input
              type="date"
              aria-label="开始日期"
              value={localDate(params.get('createdFrom'))}
              onChange={(e) =>
                change({
                  createdFrom: e.target.value
                    ? new Date(e.target.value + 'T00:00:00').toISOString()
                    : undefined,
                })
              }
            />
          </label>
          <label>
            结束日期{' '}
            <Input
              type="date"
              aria-label="结束日期"
              value={localDate(params.get('createdTo'))}
              onChange={(e) =>
                change({
                  createdTo: e.target.value
                    ? new Date(e.target.value + 'T23:59:59.999').toISOString()
                    : undefined,
                })
              }
            />
          </label>
          <Button onClick={() => setParams({})}>重置</Button>
          <Button onClick={refresh} loading={loading}>
            刷新
          </Button>
        </Space>
        {error && <RequestError error={error} retry={refresh} />}
        <Table
          rowKey="id"
          loading={loading}
          dataSource={data?.list ?? []}
          scroll={{ x: 800 }}
          locale={{ emptyText: '暂无符合条件的订单' }}
          pagination={{
            current: data?.page ?? 1,
            pageSize: data?.pageSize ?? 10,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (t) => '共 ' + t + ' 个订单',
            onChange: (page, pageSize) =>
              change(
                {
                  page: String(pageSize !== data?.pageSize ? 1 : page),
                  pageSize: String(pageSize),
                },
                false,
              ),
          }}
          columns={[
            {
              title: '订单号',
              dataIndex: 'orderNo',
              render: (v: string, r) => <Link to={'/orders/' + r.id}>{v}</Link>,
            },
            { title: '客户姓名', dataIndex: 'customerName' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (v: OrderStatus) => (
                <Tag color={ORDER_COLORS[v]}>{ORDER_LABELS[v]}</Tag>
              ),
            },
            {
              title: '金额（元）',
              dataIndex: 'totalAmount',
              render: (v: string) => '¥ ' + v,
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              render: (v: string) => new Date(v).toLocaleString(),
            },
            {
              title: '操作',
              render: (_, r) => <Link to={'/orders/' + r.id}>查看详情</Link>,
            },
          ]}
        />
      </Card>
    </div>
  );
}
