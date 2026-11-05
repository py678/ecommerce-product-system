export type OrderStatus =
  'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED';
export const ORDER_LABELS: Record<OrderStatus, string> = {
  PENDING: '待确认',
  CONFIRMED: '已确认',
  SHIPPED: '已发货',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};
export const ORDER_COLORS: Record<OrderStatus, string> = {
  PENDING: 'gold',
  CONFIRMED: 'blue',
  SHIPPED: 'purple',
  COMPLETED: 'green',
  CANCELLED: 'default',
};
export interface OrderSummary {
  id: string;
  orderNo: string;
  creatorId: string;
  customerName: string;
  status: OrderStatus;
  totalAmount: string;
  createdAt: string;
  updatedAt: string;
}
export interface OrderDetail extends OrderSummary {
  phone: string;
  address: string;
  remark: string;
  carrier: string | null;
  trackingNo: string | null;
  confirmedAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  items: {
    id: string;
    productId: string;
    productName: string;
    coverImage: string | null;
    unitPrice: string;
    quantity: number;
    subtotal: string;
  }[];
  logs: {
    id: string;
    actorId: string;
    actorName: string;
    action: string;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    reason: string;
    createdAt: string;
  }[];
}
export interface OrderQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: OrderStatus;
  createdFrom?: string;
  createdTo?: string;
}
export interface CreateOrderInput {
  idempotencyKey: string;
  customerName: string;
  phone: string;
  address: string;
  remark?: string;
  items: { productId: string; quantity: number }[];
}
export interface OrderPage {
  list: OrderSummary[];
  total: number;
  page: number;
  pageSize: number;
}
