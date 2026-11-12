import { useRealtimeEvent } from '../realtime/useRealtimeEvent';
import { useState } from 'react';
import { Alert, App, Form, Input, InputNumber, Modal } from 'antd';
import { api, errorMessage } from '../api/client';
import type { Product, ProductInput } from '../api/types';
import { trimInput } from '../utils/format';
import { CategorySelect } from './CategorySelect';
import { CoverImageUpload } from './CoverImageUpload';

export function ProductFormModal({
  product,
  onCancel,
  onSaved,
}: {
  product?: Product;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<ProductInput>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { message } = App.useApp();
  const [stale, setStale] = useState(false);
  const stock = Form.useWatch('stock', form);
  const stockChanged =
    !!product && stock !== undefined && stock !== product.stock;
  useRealtimeEvent('product:changed', (event) => {
    if (event.id === product?.id) setStale(true);
  });
  useRealtimeEvent('category:changed', () => setStale(true));
  useRealtimeEvent('realtime:connected', () => {
    if (product) setStale(true);
  });

  async function save(values: ProductInput) {
    if (uploading) return;
    setSaving(true);
    try {
      const { stockReason, ...fields } = values;
      if (product)
        await api.products.update(product.id, {
          ...fields,
          ...(fields.stock !== product.stock
            ? { stockReason: stockReason?.trim() }
            : {}),
          stockVersion: product.stockVersion,
        });
      else await api.products.create(fields);
      void message.success(product ? '商品已更新' : '商品已创建');
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
      title={product ? '编辑商品' : '新建商品'}
      width={620}
      okText={product ? '保存修改' : '创建商品'}
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: uploading }}
      onOk={() => form.submit()}
      onCancel={onCancel}
      closable={!saving && !uploading}
      mask={{ closable: !saving && !uploading }}
      cancelButtonProps={{ disabled: saving || uploading }}
    >
      {stale && (
        <Alert
          type="info"
          showIcon
          title="数据可能已变化，当前填写内容已保留；可关闭后重新打开查看最新数据。"
        />
      )}
      <Form<ProductInput>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={saving}
        onFinish={save}
        initialValues={
          product
            ? {
                name: product.name,
                description: product.description,
                coverImage: product.coverImage ?? '',
                price: product.price,
                stock: product.stock,
                categoryId: product.categoryId,
              }
            : { description: '', stock: 0, coverImage: '' }
        }
      >
        <Form.Item
          label="商品名称"
          name="name"
          normalize={trimInput}
          rules={[
            { required: true, message: '请输入商品名称' },
            { max: 200, message: '商品名称最多 200 个字符' },
          ]}
        >
          <Input placeholder="例如：USB-C 充电器" maxLength={200} />
        </Form.Item>
        <Form.Item
          label="所属分类"
          name="categoryId"
          rules={[{ required: true, message: '请选择商品分类' }]}
        >
          <CategorySelect
            initialOption={product?.category}
            placeholder="请选择商品分类"
          />
        </Form.Item>
        <div className="form-columns">
          <Form.Item
            label="价格（元）"
            name="price"
            normalize={trimInput}
            rules={[
              { required: true, message: '请输入价格' },
              {
                pattern: /^(0|[1-9]\d{0,9})(\.\d{1,2})?$(?![\s\S])/,
                message: '请输入非负金额，最多两位小数',
              },
            ]}
          >
            <Input inputMode="decimal" placeholder="0.00" prefix="¥" />
          </Form.Item>
          <Form.Item
            label="库存数量"
            name="stock"
            rules={[
              { required: true, message: '请输入库存' },
              {
                validator: (_rule, value: unknown) =>
                  typeof value === 'number' &&
                  Number.isInteger(value) &&
                  value >= 0 &&
                  value <= 2147483647
                    ? Promise.resolve()
                    : Promise.reject(new Error('请输入 0–2147483647 的整数')),
              },
            ]}
          >
            <InputNumber min={0} max={2147483647} className="full-width" />
          </Form.Item>
        </div>
        {stockChanged && (
          <Form.Item
            label="库存调整原因"
            name="stockReason"
            preserve={false}
            rules={[
              {
                required: true,
                whitespace: true,
                message: '请输入库存调整原因',
              },
              {
                max: 500,
                transform: (value: string) => value?.trim(),
                message: '库存调整原因最多 500 个字符',
              },
            ]}
          >
            <Input.TextArea
              rows={2}
              maxLength={500}
              showCount
              placeholder="说明本次库存调整的原因"
            />
          </Form.Item>
        )}
        <Form.Item
          label="商品描述"
          name="description"
          rules={[{ max: 10000, message: '描述最多 10000 个字符' }]}
        >
          <Input.TextArea
            rows={4}
            placeholder="补充规格、用途等信息（选填）"
            maxLength={10000}
            showCount
          />
        </Form.Item>
        <Form.Item
          label="商品封面"
          name="coverImage"
          extra="JPG/JPEG/PNG/WEBP，最多 5MB；移除只清空封面，不删除服务器文件。"
        >
          <CoverImageUpload
            disabled={saving}
            onUploadingChange={setUploading}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
