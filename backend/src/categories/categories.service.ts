import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import {
  CategoryPageDto,
  CategoryResponseDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/category.dto.js';

const CATEGORY_COUNT = { _count: { select: { products: true } } } as const;
type CategoryRecord = Prisma.CategoryGetPayload<{
  include: typeof CATEGORY_COUNT;
}>;

function toResponse(category: CategoryRecord): CategoryResponseDto {
  const { _count, ...fields } = category;
  return { ...fields, productCount: _count.products };
}

@Injectable()
export class CategoriesService {
  constructor(private readonly db: DatabaseService) {}

  async create(dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    return toResponse(
      await this.db.category.create({
        data: { name: dto.name },
        include: CATEGORY_COUNT,
      }),
    );
  }

  async findAll(query: PaginationDto): Promise<CategoryPageDto> {
    const where: Prisma.CategoryWhereInput = query.search
      ? { name: { contains: query.search, mode: 'insensitive' } }
      : {};
    const [items, total] = await this.db.$transaction(
      [
        this.db.category.findMany({
          where,
          include: CATEGORY_COUNT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.db.category.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: items.map(toResponse),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async findOne(id: string): Promise<CategoryResponseDto> {
    const category = await this.db.category.findUnique({
      where: { id },
      include: CATEGORY_COUNT,
    });
    if (!category) throw new NotFoundException('分类不存在');
    return toResponse(category);
  }

  async update(
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    if (dto.name === undefined)
      throw new BadRequestException('请至少提供一个可更新字段');
    try {
      return toResponse(
        await this.db.category.update({
          where: { id },
          data: { name: dto.name },
          include: CATEGORY_COUNT,
        }),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      )
        throw new NotFoundException('分类不存在');
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      // Let the database enforce the reference restriction, including concurrent product creation.
      await this.db.category.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') throw new NotFoundException('分类不存在');
        if (error.code === 'P2003' || error.code === 'P2014')
          throw new ConflictException('分类下仍有商品，请先调整或删除关联商品');
      }
      throw error;
    }
  }
}
