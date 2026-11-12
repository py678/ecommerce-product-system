import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
} from 'class-validator';
import type {
  ValidationArguments,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Prisma, ProductStatus } from '../../generated/prisma/client.js';

export enum StockStatus {
  Zero = 'zero',
  Low = 'low',
  Normal = 'normal',
}
export enum ProductSortBy {
  Price = 'price',
  Stock = 'stock',
  CreatedAt = 'createdAt',
  UpdatedAt = 'updatedAt',
}
export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc',
}
const PRICE = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$(?![\s\S])/;
const optional = (_object: unknown, value: unknown) => value !== undefined;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const integer = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

@ValidatorConstraint({ name: 'priceRange', async: false })
class PriceRange implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const min: unknown = (args.object as ProductQueryDto).minPrice;
    // Format errors are reported by Matches; compare valid decimal strings exactly.
    if (
      typeof value !== 'string' ||
      !PRICE.test(value) ||
      typeof min !== 'string' ||
      !PRICE.test(min)
    )
      return true;
    return new Prisma.Decimal(value).gte(min);
  }
  defaultMessage(): string {
    return 'maxPrice must be greater than or equal to minPrice';
  }
}

// Kept separate from shared PaginationDto so category pagination/search stays unchanged.
export class ProductQueryDto {
  @ApiPropertyOptional({
    enum: ProductStatus,
    description: '商品上架状态；省略时包含全部状态',
  })
  @ValidateIf(optional)
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({
    type: Number,
    default: 1,
    minimum: 1,
    maximum: 1000000,
    example: 1,
    description: '页码',
  })
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;

  @ApiPropertyOptional({
    type: Number,
    default: 10,
    minimum: 1,
    maximum: 100,
    example: 10,
    description: '每页条数',
  })
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 10;

  @ApiPropertyOptional({
    type: String,
    maxLength: 200,
    example: '充电器',
    description: '名称模糊匹配，不区分大小写；优先于 search',
  })
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    deprecated: true,
    maxLength: 100,
    example: '充电器',
    description: '旧名称搜索参数；请改用 name，同传时 name 优先',
  })
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  search?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    example: '96c01d96-53f3-4fb8-b761-923ab8fae3fe',
    description: '扁平分类，仅筛选当前分类',
  })
  @ValidateIf(optional)
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    type: String,
    pattern: PRICE.source,
    example: '10.00',
    description:
      '价格下限（>=），非负金额字符串，最多两位小数，最大 9999999999.99',
  })
  @ValidateIf(optional)
  @IsString()
  @Matches(PRICE)
  minPrice?: string;

  @ApiPropertyOptional({
    type: String,
    pattern: PRICE.source,
    example: '100.00',
    description: '价格上限（<=），格式同 minPrice，必须 >= minPrice',
  })
  @ValidateIf(optional)
  @IsString()
  @Matches(PRICE)
  @Validate(PriceRange)
  maxPrice?: string;

  @ApiPropertyOptional({
    enum: StockStatus,
    example: 'low',
    description:
      'zero: stock = 0；low: stock > 0 且 stock < LOW_STOCK_THRESHOLD；normal: stock >= LOW_STOCK_THRESHOLD。全局配置默认 6',
  })
  @ValidateIf(optional)
  @IsEnum(StockStatus)
  stockStatus?: StockStatus;

  @ApiPropertyOptional({
    enum: ProductSortBy,
    default: 'createdAt',
    example: 'price',
    description: '排序字段白名单；NULLS LAST；id 同方向稳定排序',
  })
  @IsEnum(ProductSortBy)
  sortBy: ProductSortBy = ProductSortBy.CreatedAt;

  @ApiPropertyOptional({
    enum: SortOrder,
    default: 'desc',
    example: 'asc',
    description: '主字段及 id 的排序方向',
  })
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.Desc;
}
