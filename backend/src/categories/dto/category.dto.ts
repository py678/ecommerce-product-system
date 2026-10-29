import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { PageMetadataDto } from '../../common/dto/pagination.dto.js';

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
