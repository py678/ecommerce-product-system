import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '../../generated/prisma/client.js';
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class OrderItemInputDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productId: string;
  @ApiProperty({ minimum: 1, maximum: 9999, example: 1 })
  @IsInt()
  @Min(1)
  @Max(9999)
  quantity: number;
}
export class CreateOrderDto {
  @ApiProperty({
    format: 'uuid',
    description: '同一用户的重试键，相同内容重试复用；改内容必须换键',
  })
  @IsUUID()
  idempotencyKey: string;
  @ApiProperty({ minLength: 1, maxLength: 80, example: '示例客户' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  customerName: string;
  @ApiProperty({
    minLength: 5,
    maxLength: 32,
    example: '13800000000',
    pattern: '^[0-9+() -]+$',
  })
  @Transform(trim)
  @IsString()
  @Length(5, 32)
  @Matches(/^[0-9+() -]+$/)
  phone: string;
  @ApiProperty({ minLength: 1, maxLength: 500, example: '示例收货地址' })
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  address: string;
  @ApiPropertyOptional({ maxLength: 1000 })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  remark?: string;
  @ApiProperty({ type: [OrderItemInputDto], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];
}
export class OrderQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 2147483647 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  page = 1;
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 10;
  @ApiPropertyOptional({
    maxLength: 100,
    description: '订单号或客户姓名模糊匹配',
    example: '示例',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiPropertyOptional({ enum: OrderStatus })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(OrderStatus)
  status?: OrderStatus;
  @ApiPropertyOptional({
    format: 'date-time',
    description: '创建时间起点（含）',
    example: '2026-11-01T00:00:00Z',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsDateString({ strict: true })
  createdFrom?: string;
  @ApiPropertyOptional({
    format: 'date-time',
    description: '创建时间终点（含）',
    example: '2026-11-30T23:59:59Z',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsDateString({ strict: true })
  createdTo?: string;
}
export class ShipOrderDto {
  @ApiProperty({ minLength: 1, maxLength: 80, example: '示例物流' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  carrier: string;
  @ApiProperty({ minLength: 1, maxLength: 80, example: 'TEST001' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  trackingNo: string;
}
export class CancelOrderDto {
  @ApiProperty({ minLength: 1, maxLength: 500, example: '录单错误' })
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  reason: string;
}
export class EmptyOrderActionDto {}
export class OrderSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() orderNo: string;
  @ApiProperty({ format: 'uuid' }) creatorId: string;
  @ApiProperty() customerName: string;
  @ApiProperty({ enum: OrderStatus }) status: OrderStatus;
  @ApiProperty({ type: String, example: '24.70' }) totalAmount: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}
export class OrderItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) productId: string;
  @ApiProperty() productName: string;
  @ApiProperty({ type: String, nullable: true }) coverImage: string | null;
  @ApiProperty({ type: String, example: '12.35' }) unitPrice: string;
  @ApiProperty() quantity: number;
  @ApiProperty({ type: String, example: '24.70' }) subtotal: string;
}
export class OrderLogResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) actorId: string;
  @ApiProperty() actorName: string;
  @ApiProperty() action: string;
  @ApiProperty({ enum: OrderStatus, nullable: true })
  fromStatus: OrderStatus | null;
  @ApiProperty({ enum: OrderStatus }) toStatus: OrderStatus;
  @ApiProperty() reason: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}
export class OrderDetailDto extends OrderSummaryDto {
  @ApiProperty() phone: string;
  @ApiProperty() address: string;
  @ApiProperty() remark: string;
  @ApiProperty({ type: String, nullable: true }) carrier: string | null;
  @ApiProperty({ type: String, nullable: true }) trackingNo: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  confirmedAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  shippedAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt: Date | null;
  @ApiProperty({ type: [OrderItemResponseDto] }) items: OrderItemResponseDto[];
  @ApiProperty({ type: [OrderLogResponseDto] }) logs: OrderLogResponseDto[];
}
export class OrderPageDto {
  @ApiProperty({ type: [OrderSummaryDto] }) list: OrderSummaryDto[];
  @ApiProperty() total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) pageSize: number;
}
