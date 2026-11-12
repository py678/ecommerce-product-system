import { ReloadOutlined } from '@ant-design/icons';
import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Typography,
} from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import type { Product } from '../api/types';
import type { CreateOrderInput } from '../orders/order-types';
import { useResource } from '../hooks/useResource';
import { RequestError } from '../components/PageFeedback';
import { useRealtimeRefresh } from '../realtime/useRealtimeRefresh';

type Customer = Pick<
  CreateOrderInput,
  'customerName' | 'phone' | 'address' | 'remark'
>;
function cents(price: string) {
  return BigInt(price.replace('.', ''));
}
function money(value: bigint) {
  return (
    (value / 100n).toString() + '.' + (value % 100n).toString().padStart(2, '0')
  );
}
export function OrderCreatePage() {
  const [form] = Form.useForm<Customer>();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>(
    [],
  );
  const [selecting, setSelecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const load = useCallback(
    (signal: AbortSignal) =>
      api.products.list(
        {
          page,
          pageSize: 10,
          name: search || undefined,
          status: 'PUBLISHED',
          sortBy: 'createdAt',
          sortOrder: 'desc',
        },
        signal,
      ),
    [page, search],
  );
  const resource = useResource(load);
  useRealtimeRefresh(resource.refresh, { products: true });
  async function save(values: Customer) {
    if (!cart.length) {
      void message.error('请至少选择一种商品');
      return;
    }
    const body = {
      customerName: values.customerName.trim(),
      phone: values.phone.trim(),
      address: values.address.trim(),
      remark: values.remark?.trim() ?? '',
      items: cart
        .map((i) => ({ productId: i.product.id, quantity: i.quantity }))
        .sort((a, b) => a.productId.localeCompare(b.productId)),
    };
    const fingerprint = JSON.stringify(body);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    setSaving(true);
    try {
      const order = await api.orders.create({
        ...body,
        idempotencyKey: retry.current.key,
      });
      void message.success('订单已创建，库存已扣减');
      navigate('/orders/' + order.id, { replace: true });
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="orders-workspace">
      <div className="page-heading">
        <Typography.Title level={2}>创建订单</Typography.Title>
        <Link to="/orders">返回订单列表</Link>
      </div>
      <Alert
        type="info"
        showIcon
        title="创建即扣库存；客户信息与商品明细创建后固定，录错请取消重建。金额以服务器成交快照为准。"
      />
      <Card title="客户信息">
        <Form form={form} layout="vertical" disabled={saving} onFinish={save}>
          <Form.Item
            name="customerName"
            label="客户姓名"
            rules={[
              { required: true, whitespace: true, message: '请输入客户姓名' },
              { max: 80, message: '最多80个字符' },
            ]}
          >
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item
            name="phone"
            label="联系电话"
            rules={[
              { required: true, message: '请输入联系电话' },
              { min: 5, max: 32, message: '请输入5–32个字符' },
              {
                pattern: /^[0-9+() -]+$/,
                message: '仅允许数字、空格、+、-和括号',
              },
            ]}
          >
            <Input maxLength={32} />
          </Form.Item>
          <Form.Item
            name="address"
            label="收货地址"
            rules={[
              { required: true, whitespace: true, message: '请输入收货地址' },
              { max: 500, message: '最多500个字符' },
            ]}
          >
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
          <Form.Item
            name="remark"
            label="备注"
            rules={[{ max: 1000, message: '最多1000个字符' }]}
          >
            <Input.TextArea maxLength={1000} />
          </Form.Item>
        </Form>
      </Card>
      <Card
        title="商品明细"
        extra={
          <Button
            disabled={saving || cart.length >= 50}
            onClick={() => setSelecting(true)}
          >
            选择商品
          </Button>
        }
      >
        <Table
          rowKey={(i) => i.product.id}
          pagination={false}
          dataSource={cart}
          scroll={{ x: 600 }}
          locale={{ emptyText: '请选择1–50种不同商品' }}
          columns={[
            { title: '商品', render: (_, i) => i.product.name },
            { title: '单价预览', render: (_, i) => '¥ ' + i.product.price },
            { title: '参考库存', render: (_, i) => i.product.stock },
            {
              title: '数量',
              render: (_, i) => (
                <InputNumber
                  aria-label={'数量 ' + i.product.name}
                  min={1}
                  max={9999}
                  precision={0}
                  value={i.quantity}
                  disabled={saving}
                  onChange={(value) =>
                    setCart((c) =>
                      c.map((x) =>
                        x.product.id === i.product.id
                          ? { ...x, quantity: value ?? 1 }
                          : x,
                      ),
                    )
                  }
                />
              ),
            },
            {
              title: '小计预览',
              render: (_, i) =>
                '¥ ' + money(cents(i.product.price) * BigInt(i.quantity)),
            },
            {
              title: '操作',
              render: (_, i) => (
                <Button
                  type="link"
                  danger
                  disabled={saving}
                  onClick={() =>
                    setCart((c) =>
                      c.filter((x) => x.product.id !== i.product.id),
                    )
                  }
                >
                  移除
                </Button>
              ),
            },
          ]}
        />
        <div className="order-total">
          预计合计 ¥{' '}
          {money(
            cart.reduce(
              (sum, i) => sum + cents(i.product.price) * BigInt(i.quantity),
              0n,
            ),
          )}
        </div>
        <Button
          type="primary"
          loading={saving}
          disabled={!cart.length}
          onClick={() => form.submit()}
        >
          创建订单并扣减库存
        </Button>
      </Card>
      <Modal
        title="选择共享商品"
        open={selecting}
        footer={
          <Button type="primary" onClick={() => setSelecting(false)}>
            完成选择
          </Button>
        }
        width={800}
        onCancel={() => setSelecting(false)}
      >
        <Space>
          <Input.Search
            aria-label="搜索可选商品"
            placeholder="商品名称"
            allowClear
            onSearch={(v) => {
              setSearch(v.trim());
              setPage(1);
            }}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={resource.refresh}
            loading={resource.loading}
          >
            刷新库存
          </Button>
        </Space>
        {resource.error && (
          <RequestError error={resource.error} retry={resource.refresh} />
        )}
        <Table
          rowKey="id"
          loading={resource.loading}
          dataSource={
            resource.data?.list.filter((p) => p.status === 'PUBLISHED') ?? []
          }
          pagination={{
            current: page,
            pageSize: 10,
            total: resource.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          columns={[
            { title: '商品名称', dataIndex: 'name' },
            { title: '单价', dataIndex: 'price' },
            { title: '库存', dataIndex: 'stock' },
            {
              title: '操作',
              render: (_, p) => (
                <Button
                  disabled={
                    p.stock === 0 ||
                    cart.some((i) => i.product.id === p.id) ||
                    cart.length >= 50
                  }
                  onClick={() =>
                    setCart((c) => [...c, { product: p, quantity: 1 }])
                  }
                >
                  加入订单
                </Button>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
}
