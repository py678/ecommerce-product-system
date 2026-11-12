import { ReloadOutlined } from '@ant-design/icons';
import {
  Button,
  DatePicker,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import type { Dayjs } from 'dayjs';
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type {
  StockMovement,
  StockMovementQuery,
  StockMovementType,
} from '../api/types';
import { can } from '../auth/permissions';
import { useAuth } from '../auth/useAuth';
import { useResource } from '../hooks/useResource';
import { useRealtimeRefresh } from '../realtime/useRealtimeRefresh';
import { formatTime } from '../utils/format';
import { RequestError } from './PageFeedback';

const labels: Record<StockMovementType, string> = {
  BASELINE: '启用基线',
  INITIAL: '初始库存',
  ADJUSTMENT: '手动调整',
  ORDER_DEDUCT: '订单扣减',
  ORDER_CANCEL: '取消回补',
};
interface Filters {
  type?: StockMovementType;
  dates?: [Dayjs, Dayjs];
  orderNo?: string;
}

// 查询条件和页码独立保存；手动刷新、资源事件与重连均复用当前查询。
export function StockMovements({
  productId,
  orderId,
}: {
  productId?: string;
  orderId?: string;
}) {
  const { user } = useAuth();
  const [query, setQuery] = useState<StockMovementQuery>({
    page: 1,
    pageSize: 10,
  });
  const load = useCallback(
    (signal: AbortSignal) =>
      orderId
        ? api.stockMovements.forOrder(orderId, query, signal)
        : productId
          ? api.stockMovements.forProduct(productId, query, signal)
          : api.stockMovements.list(query, signal),
    [orderId, productId, query],
  );
  const { data, loading, error, refresh } = useResource(load);
  useRealtimeRefresh(refresh, { products: true, orders: true });
  return (
    <div aria-label="库存流水记录">
      <Form<Filters>
        layout="inline"
        onFinish={(values) =>
          setQuery({
            page: 1,
            pageSize: query.pageSize,
            type: values.type,
            orderNo: values.orderNo?.trim() || undefined,
            createdFrom: values.dates?.[0].startOf('day').toISOString(),
            createdTo: values.dates?.[1].endOf('day').toISOString(),
          })
        }
        style={{ marginBottom: 20, rowGap: 12 }}
      >
        <Form.Item name="type" label="变动类型">
          <Select
            aria-label="变动类型"
            allowClear
            placeholder="全部类型"
            style={{ width: 150 }}
            options={Object.entries(labels).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </Form.Item>
        <Form.Item name="dates" label="发生日期">
          <DatePicker.RangePicker allowClear />
        </Form.Item>
        <Form.Item name="orderNo">
          <Input placeholder="筛选订单号" maxLength={40} allowClear />
        </Form.Item>
        <Space>
          <Button htmlType="submit" type="primary">
            查询流水
          </Button>
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
            刷新流水
          </Button>
        </Space>
      </Form>
      {error ? (
        <RequestError error={error} retry={refresh} />
      ) : (
        <Table<StockMovement>
          rowKey="id"
          dataSource={data?.list ?? []}
          loading={loading}
          locale={{ emptyText: '暂无库存流水' }}
          scroll={{ x: 1200 }}
          pagination={{
            current: query.page,
            pageSize: query.pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, pageSize) =>
              setQuery((current) => ({
                ...current,
                page: pageSize !== current.pageSize ? 1 : page,
                pageSize,
              })),
          }}
          columns={[
            {
              title: '发生时间',
              dataIndex: 'createdAt',
              width: 175,
              render: formatTime,
            },
            { title: '商品', dataIndex: 'productName', width: 140 },
            {
              title: '变动类型',
              dataIndex: 'type',
              width: 110,
              render: (type: StockMovementType) => <Tag>{labels[type]}</Tag>,
            },
            { title: '变化前', dataIndex: 'beforeStock', width: 85 },
            {
              title: '变化量',
              dataIndex: 'quantityChange',
              width: 85,
              render: (value: number) => (
                <span
                  style={{
                    color:
                      value > 0 ? '#389e0d' : value < 0 ? '#cf1322' : undefined,
                  }}
                >
                  {value > 0 ? '+' : ''}
                  {value}
                </span>
              ),
            },
            { title: '变化后', dataIndex: 'afterStock', width: 85 },
            { title: '版本', dataIndex: 'stockVersion', width: 70 },
            {
              title: '操作人',
              dataIndex: 'actorName',
              width: 100,
              render: (name: string | null) => name || '系统',
            },
            {
              title: '关联订单',
              dataIndex: 'orderNo',
              width: 170,
              render: (orderNo: string | null, row) =>
                row.orderId &&
                row.canViewOrder === true &&
                can(user, 'order:read') ? (
                  <Link to={`/orders/${row.orderId}`}>
                    {orderNo || '查看订单'}
                  </Link>
                ) : (
                  orderNo || '—'
                ),
            },
            { title: '原因', dataIndex: 'reason', width: 200 },
          ]}
        />
      )}
    </div>
  );
}
