import { Transform } from 'class-transformer';
import {
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
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsCoverImageUrl } from './cover-image.validator.js';
import { PageMetadataDto } from '../../common/dto/pagination.dto.js';
import { ProductStatus } from '../../generated/prisma/client.js';

export class UpdateProductStatusDto {
  @ApiProperty({ enum: ProductStatus, example: 'OFFLINE' })
  @IsEnum(ProductStatus)
  status: ProductStatus;
}

export class CreateProductDto {
  @ApiProperty({ example: 'USB-C 充电器', minLength: 1, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiPropertyOptional({ maxLength: 10000, default: '' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 2048,
    description:
      '上传返回的 /uploads/UUID.ext 路径或 HTTP(S) URL；空字符串清空封面',
    example: '/uploads/96c01d96-53f3-4fb8-b761-923ab8fae3fe.png',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(2048)
  @IsCoverImageUrl()
  coverImage?: string;

  @ApiProperty({
    type: String,
    example: '129.90',
    pattern: '^(0|[1-9]\\d{0,9})(\\.\\d{1,2})?$(?![\\s\\S])',
    description: '非负金额字符串，最多两位小数，最大 9999999999.99',
  })
  @IsString()
  @Matches(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$(?![\s\S])/, {
    message:
      'price must be a nonnegative decimal string with at most 10 integer digits and 2 decimal places',
  })
  price: string;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 2147483647 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  stock?: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId: string;
}

export class UpdateProductDto extends PartialType(CreateProductDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 500,
    description: '实际库存变化时必填，说明调整原因；同值或仅修改资料时可省略',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 500)
  stockReason?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: '提交 stock 时必填；使用读取时的版本，过期返回409',
  })
  @ValidateIf(
    (object: UpdateProductDto, value) =>
      object.stock !== undefined || value !== undefined,
  )
  @IsInt()
  @Min(0)
  @Max(2147483647)
  stockVersion?: number;
}

export { ProductQueryDto } from './product-query.dto.js';

class ProductCategoryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

class ProductUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  username: string;
}

export class ProductResponseDto {
  @ApiProperty({ enum: ProductStatus, default: 'PUBLISHED' })
  status: ProductStatus;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ format: 'uuid' })
  categoryId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '封面 URL，无封面时为 null',
  })
  coverImage: string | null;

  @ApiProperty({ type: String, example: '129.90' })
  price: string;

  @ApiProperty()
  stock: number;

  @ApiProperty({ minimum: 0, description: '库存乐观并发版本' })
  stockVersion: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ type: ProductCategoryDto })
  category: ProductCategoryDto;

  @ApiProperty({ type: ProductUserDto })
  user: ProductUserDto;
}

export class ProductPageDto extends PageMetadataDto {
  @ApiProperty({ type: [ProductResponseDto], description: '商品列表' })
  list: ProductResponseDto[];

  @ApiProperty({
    description:
      '全局低库存阈值：0 < stock < 此值为 low；stock >= 此值为 normal',
    example: 6,
  })
  lowStockThreshold: number;

  @ApiProperty({
    deprecated: true,
    description: '兼容旧客户端；请使用 total 和 pageSize 计算',
  })
  declare totalPages: number;

  @ApiProperty({
    type: [ProductResponseDto],
    deprecated: true,
    description: '兼容旧客户端，与 list 相同',
  })
  items: ProductResponseDto[];
}
