import { ReloadOutlined } from '@ant-design/icons';
import { useCallback, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useResource } from '../hooks/useResource';
import { useRealtimeRefresh } from '../realtime/useRealtimeRefresh';
import { LoadingScreen, RequestError } from '../components/PageFeedback';
import { can, canManageOrder } from '../auth/permissions';
import { StockMovements } from '../components/StockMovements';
import { useAuth } from '../auth/useAuth';
import { ORDER_COLORS, ORDER_LABELS } from '../orders/order-types';

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { message } = App.useApp();
  const load = useCallback(
    (signal: AbortSignal) => api.orders.get(id, signal),
    [id],
  );
  const { data: o, loading, error, refresh } = useResource(load);
  const [action, setAction] = useState<'ship' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<{
    carrier: string;
    trackingNo: string;
    reason: string;
  }>();
  useRealtimeRefresh(refresh, { orders: true, paused: !!action || busy });
  async function mutate(
    kind: 'confirm' | 'ship' | 'complete' | 'cancel',
    values: object = {},
  ) {
    setBusy(true);
    try {
      await api.orders.action(id, kind, values);
      void message.success('订单状态已更新');
      setAction(null);
      form.resetFields();
      refresh();
    } catch (e) {
      void message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (error) return <RequestError error={error} retry={refresh} />;
  if (!o) return <LoadingScreen />;
  return (
    <div className="orders-workspace">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>订单详情</Typography.Title>
          <Typography.Text copyable>{o.orderNo}</Typography.Text>
        </div>
        <Link to="/orders">返回订单列表</Link>
      </div>
      <Card
        title={
          <Space>
            订单状态
            <Tag color={ORDER_COLORS[o.status]}>{ORDER_LABELS[o.status]}</Tag>
          </Space>
        }
        loading={loading}
      >
        <Space wrap>
          {o.status === 'PENDING' &&
            canManageOrder(user, o.creatorId, 'order:confirm') && (
              <Popconfirm
                title="手动确认该订单？此操作不代表支付成功。"
                onConfirm={() => mutate('confirm')}
              >
                <Button type="primary" loading={busy}>
                  确认订单
                </Button>
              </Popconfirm>
            )}
          {o.status === 'CONFIRMED' &&
            canManageOrder(user, o.creatorId, 'order:ship') && (
              <Button
                type="primary"
                disabled={busy}
                onClick={() => setAction('ship')}
              >
                填写物流并发货
              </Button>
            )}
          {o.status === 'SHIPPED' &&
            canManageOrder(user, o.creatorId, 'order:complete') && (
              <Popconfirm
                title="确认该订单已完成？"
                onConfirm={() => mutate('complete')}
              >
                <Button type="primary" loading={busy}>
                  完成订单
                </Button>
              </Popconfirm>
            )}
          {['PENDING', 'CONFIRMED'].includes(o.status) &&
            canManageOrder(user, o.creatorId, 'order:cancel') && (
              <Button
                danger
                disabled={busy}
                onClick={() => setAction('cancel')}
              >
                取消订单
              </Button>
            )}
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
            刷新
          </Button>
        </Space>
        <Alert
          className="order-notice"
          type="info"
          showIcon
          title={
            ['SHIPPED', 'COMPLETED'].includes(o.status)
              ? '已发货订单不允许取消，库存不回补。'
              : o.status === 'CANCELLED'
                ? '订单已取消，库存已回补。'
                : '由创建人或管理员手动确认；待确认或已确认时可取消并回补库存。'
          }
        />
        <Descriptions
          column={{ xs: 1, sm: 2 }}
          items={[
            { key: 'total', label: '成交金额', children: '¥ ' + o.totalAmount },
            { key: 'customer', label: '客户姓名', children: o.customerName },
            { key: 'phone', label: '联系电话', children: o.phone },
            { key: 'address', label: '收货地址', children: o.address },
            { key: 'remark', label: '备注', children: o.remark || '—' },
            {
              key: 'created',
              label: '创建时间',
              children: new Date(o.createdAt).toLocaleString(),
            },
            { key: 'carrier', label: '物流公司', children: o.carrier || '—' },
            { key: 'tracking', label: '运单号', children: o.trackingNo || '—' },
          ]}
        />
      </Card>
      <Card title="成交商品快照">
        <Table
          rowKey="id"
          dataSource={o.items}
          pagination={false}
          scroll={{ x: 550 }}
          columns={[
            { title: '商品名称', dataIndex: 'productName' },
            { title: '成交单价', dataIndex: 'unitPrice' },
            { title: '数量', dataIndex: 'quantity' },
            { title: '小计', dataIndex: 'subtotal' },
          ]}
        />
      </Card>
      <Card title="操作记录">
        <Timeline
          items={o.logs.map((log) => ({
            key: log.id,
            content: (
              <div>
                <strong>{log.actorName}</strong> → {ORDER_LABELS[log.toStatus]}{' '}
                {log.reason && '（' + log.reason + '）'}
                <div className="muted">
                  {new Date(log.createdAt).toLocaleString()}
                </div>
              </div>
            ),
          }))}
        />
      </Card>
      {can(user, 'stock:read') && (
        <Card title="库存变动">
          <StockMovements key={o.id} orderId={o.id} />
        </Card>
      )}
      <Modal
        title={action === 'ship' ? '填写物流并发货' : '取消订单并回补库存'}
        open={!!action}
        confirmLoading={busy}
        onOk={() => form.submit()}
        onCancel={() => {
          if (!busy) {
            setAction(null);
            form.resetFields();
          }
        }}
        cancelButtonProps={{ disabled: busy }}
        mask={{ closable: !busy }}
        closable={!busy}
        okText={action === 'ship' ? '确认发货' : '确认取消'}
        cancelText="返回"
      >
        <Form
          form={form}
          layout="vertical"
          disabled={busy}
          onFinish={(v) => {
            if (action)
              void mutate(
                action,
                action === 'ship'
                  ? {
                      carrier: v.carrier.trim(),
                      trackingNo: v.trackingNo.trim(),
                    }
                  : { reason: v.reason.trim() },
              );
          }}
        >
          {action === 'ship' ? (
            <>
              <Form.Item
                name="carrier"
                label="物流公司"
                rules={[
                  {
                    required: true,
                    whitespace: true,
                    message: '请输入物流公司',
                  },
                  { max: 80, message: '最多80个字符' },
                ]}
              >
                <Input maxLength={80} />
              </Form.Item>
              <Form.Item
                name="trackingNo"
                label="运单号"
                rules={[
                  { required: true, whitespace: true, message: '请输入运单号' },
                  { max: 80, message: '最多80个字符' },
                ]}
              >
                <Input maxLength={80} />
              </Form.Item>
            </>
          ) : (
            <Form.Item
              name="reason"
              label="取消原因"
              rules={[
                { required: true, whitespace: true, message: '请输入取消原因' },
                { max: 500, message: '最多500个字符' },
              ]}
            >
              <Input.TextArea maxLength={500} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
