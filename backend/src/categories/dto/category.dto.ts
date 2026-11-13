import { Transform } from 'class-transformer';
import { IsEnum, IsString, Length, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  PageMetadataDto,
  PaginationDto,
} from '../../common/dto/pagination.dto.js';

export enum CategoryProductPresence {
  WITH = 'with',
  WITHOUT = 'without',
}

export class CategoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: CategoryProductPresence,
    description:
      '关联商品：with 有商品，without 无商品；不传为全部，包含所有上下架状态商品',
    example: 'without',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(CategoryProductPresence)
  productPresence?: CategoryProductPresence;
}

export class CreateCategoryDto {
  @ApiProperty({ example: '数码配件', minLength: 1, maxLength: 120 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 120)
  name: string;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto, {
  skipNullProperties: false,
}) {}

export class CategoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ description: '当前关联商品数量' })
  productCount: number;
}

export class CategoryPageDto extends PageMetadataDto {
  @ApiProperty({ type: [CategoryResponseDto] })
  items: CategoryResponseDto[];
}
