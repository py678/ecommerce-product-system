import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockMovementType } from '../../generated/prisma/client.js';
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class StockMovementQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 10;
  @ApiPropertyOptional({ enum: StockMovementType })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(StockMovementType)
  type?: StockMovementType;
  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsDateString()
  createdFrom?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsDateString()
  createdTo?: string;
  @ApiPropertyOptional({ maxLength: 40 })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  orderNo?: string;
}
export class GlobalStockMovementQueryDto extends StockMovementQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID()
  productId?: string;
  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name?: string;
}
export class StockMovementResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) productId: string;
  @ApiProperty() productName: string;
  @ApiProperty({ enum: StockMovementType }) type: StockMovementType;
  @ApiProperty() beforeStock: number;
  @ApiProperty() quantityChange: number;
  @ApiProperty() afterStock: number;
  @ApiProperty() stockVersion: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) actorId:
    string | null;
  @ApiProperty({ type: String, nullable: true }) actorName: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) orderId:
    string | null;
  @ApiProperty({ type: String, nullable: true }) orderNo: string | null;
  @ApiProperty() reason: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ description: '当前账号另具备关联订单读取权限和范围' })
  canViewOrder: boolean;
}
export class StockMovementPageDto {
  @ApiProperty({ type: [StockMovementResponseDto] })
  list: StockMovementResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}
