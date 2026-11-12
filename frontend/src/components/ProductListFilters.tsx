import { useEffect, useRef, useState } from 'react';
import { Form, Input, Select } from 'antd';
import type { ProductListQuery } from '../api/types';
import { productQueryErrors } from '../pages/product-list-query';
import { useAuth } from '../auth/useAuth';
import { can } from '../auth/permissions';
import { CategorySelect } from './CategorySelect';

interface Props {
  query: ProductListQuery;
  onChange: (patch: Partial<ProductListQuery>) => void;
}

export function ProductListFilters({ query, onChange }: Props) {
  const { user } = useAuth();
  const [name, setName] = useState(query.name ?? '');
  const composing = useRef(false);
  // Keep browser history/URL restoration, but never overwrite unfinished IME text.
  useEffect(() => {
    if (!composing.current) setName(query.name ?? '');
  }, [query.name]);
  const errors = productQueryErrors(query);
  return (
    <div className="product-list-filters">
      <Form.Item
        label="商品名称"
        validateStatus={errors.name ? 'error' : undefined}
        help={errors.name}
      >
        <Input.Search
          aria-label="搜索商品"
          placeholder="搜索商品名称"
          value={name}
          maxLength={200}
          allowClear
          enterButton="搜索"
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            const value = event.currentTarget.value;
            setName(value);
            onChange({ name: value || undefined });
          }}
          onChange={(event) => {
            const value = event.target.value;
            setName(value);
            if (!composing.current) onChange({ name: value || undefined });
          }}
          onSearch={(value) => {
            if (composing.current) return;
            const trimmed = value.trim();
            setName(trimmed);
            onChange({ name: trimmed || undefined });
          }}
        />
      </Form.Item>
      {can(user, 'category:read') && (
        <Form.Item label="商品分类">
          <CategorySelect
            value={query.categoryId}
            allowClear
            placeholder="全部分类"
            onChange={(categoryId) => onChange({ categoryId })}
          />
        </Form.Item>
      )}
      <Form.Item
        label="最低价"
        validateStatus={errors.minPrice ? 'error' : undefined}
        help={errors.minPrice}
      >
        <Input
          aria-label="最低价"
          inputMode="decimal"
          placeholder="包含此价格"
          value={query.minPrice ?? ''}
          allowClear
          onChange={(event) =>
            onChange({ minPrice: event.target.value || undefined })
          }
        />
      </Form.Item>
      <Form.Item
        label="最高价"
        validateStatus={errors.maxPrice ? 'error' : undefined}
        help={errors.maxPrice}
      >
        <Input
          aria-label="最高价"
          inputMode="decimal"
          placeholder="包含此价格"
          value={query.maxPrice ?? ''}
          allowClear
          onChange={(event) =>
            onChange({ maxPrice: event.target.value || undefined })
          }
        />
      </Form.Item>
      <Form.Item label="库存状态">
        <Select
          aria-label="库存状态"
          value={query.stockStatus}
          allowClear
          placeholder="全部库存"
          onChange={(stockStatus) => onChange({ stockStatus })}
          options={[
            { value: 'zero', label: '零库存' },
            { value: 'low', label: '低库存' },
            { value: 'normal', label: '正常库存' },
          ]}
        />
      </Form.Item>
      <Form.Item label="上下架状态">
        <Select
          aria-label="上下架状态"
          value={query.status}
          allowClear
          placeholder="全部状态"
          onChange={(status) => onChange({ status })}
          options={[
            { value: 'PUBLISHED', label: '已上架' },
            { value: 'OFFLINE', label: '已下架' },
          ]}
        />
      </Form.Item>
      <Form.Item label="排序字段">
        <Select
          aria-label="排序字段"
          value={query.sortBy}
          onChange={(sortBy) => onChange({ sortBy })}
          options={[
            { value: 'price', label: '价格' },
            { value: 'stock', label: '库存' },
            { value: 'createdAt', label: '创建时间' },
            { value: 'updatedAt', label: '更新时间' },
          ]}
        />
      </Form.Item>
      <Form.Item label="排序方向">
        <Select
          aria-label="排序方向"
          value={query.sortOrder}
          onChange={(sortOrder) => onChange({ sortOrder })}
          options={[
            { value: 'asc', label: '升序' },
            { value: 'desc', label: '降序' },
          ]}
        />
      </Form.Item>
    </div>
  );
}
