import { Transform } from 'class-transformer';
import {
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
import {
  PageMetadataDto,
  PaginationDto,
} from '../../common/dto/pagination.dto.js';

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
}) {}

export class ProductQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid', description: '按分类筛选' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  categoryId?: string;
}

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

  @ApiProperty({ type: String, example: '129.90' })
  price: string;

  @ApiProperty()
  stock: number;

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
  @ApiProperty({ type: [ProductResponseDto] })
  items: ProductResponseDto[];
}
