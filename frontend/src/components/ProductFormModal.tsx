import { useState } from 'react';
import { App, Form, Input, InputNumber, Modal } from 'antd';
import { api, errorMessage } from '../api/client';
import type { Product, ProductInput } from '../api/types';
import { trimInput } from '../utils/format';
import { CategorySelect } from './CategorySelect';

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
  const { message } = App.useApp();

  async function save(values: ProductInput) {
    setSaving(true);
    try {
      if (product) await api.products.update(product.id, values);
      else await api.products.create(values);
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
      onOk={() => form.submit()}
      onCancel={onCancel}
      closable={!saving}
      mask={{ closable: !saving }}
      cancelButtonProps={{ disabled: saving }}
    >
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
                price: product.price,
                stock: product.stock,
                categoryId: product.categoryId,
              }
            : { description: '', stock: 0 }
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
      </Form>
    </Modal>
  );
}
