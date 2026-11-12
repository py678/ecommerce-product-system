import { useRef, useState } from 'react';
import { App, Button, Popconfirm } from 'antd';
import { api, errorMessage } from '../api/client';
import type { Product } from '../api/types';

interface Props {
  product: Product;
  onChanged: () => void;
  compact?: boolean;
}

export function ProductStatusAction({ product, onChanged, compact }: Props) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const nextStatus = product.status === 'PUBLISHED' ? 'OFFLINE' : 'PUBLISHED';
  const action = nextStatus === 'PUBLISHED' ? '上架' : '下架';

  async function changeStatus() {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      await api.products.updateStatus(product.id, nextStatus);
      void message.success(`商品已${action}`);
      onChanged();
    } catch (cause) {
      void message.error(errorMessage(cause));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <Popconfirm
      title={`确认${action}商品？`}
      description={
        nextStatus === 'OFFLINE'
          ? '下架后无法加入新订单，已有订单不受影响。'
          : '上架后可用于创建新订单。'
      }
      okText={action}
      cancelText="取消"
      disabled={saving}
      onConfirm={changeStatus}
      okButtonProps={{ loading: saving }}
      cancelButtonProps={{ disabled: saving }}
    >
      <Button
        type={compact ? 'link' : 'default'}
        size={compact ? 'small' : 'large'}
        loading={saving}
        disabled={saving}
      >
        {action}
      </Button>
    </Popconfirm>
  );
}
