import { Tag } from 'antd';
import type { ProductStatus } from '../api/types';

export function ProductStatusTag({ status }: { status: ProductStatus }) {
  return (
    <Tag color={status === 'PUBLISHED' ? 'success' : 'default'}>
      {status === 'PUBLISHED' ? '已上架' : '已下架'}
    </Tag>
  );
}
