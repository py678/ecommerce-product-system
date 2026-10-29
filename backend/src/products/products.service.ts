import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  CreateProductDto,
  ProductPageDto,
  ProductQueryDto,
  ProductResponseDto,
  UpdateProductDto,
} from './dto/product.dto.js';

const PRODUCT_RELATIONS = {
  category: { select: { id: true, name: true } },
  user: { select: { id: true, username: true } },
} as const;
type ProductRecord = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_RELATIONS;
}>;

function toResponse(product: ProductRecord): ProductResponseDto {
  return { ...product, price: product.price.toFixed(2) };
}

@Injectable()
export class ProductsService {
  constructor(private readonly db: DatabaseService) {}

  async create(
    userId: string,
    dto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    await this.requireCategory(dto.categoryId);
    try {
      return toResponse(
        await this.db.product.create({
          data: {
            userId,
            categoryId: dto.categoryId,
            name: dto.name,
            description: dto.description,
            price: dto.price,
            stock: dto.stock,
          },
          include: PRODUCT_RELATIONS,
        }),
      );
    } catch (error) {
      return this.handleWriteError(error);
    }
  }

  async findAll(query: ProductQueryDto): Promise<ProductPageDto> {
    const where: Prisma.ProductWhereInput = {
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    };
    const [items, total] = await this.db.$transaction(
      [
        this.db.product.findMany({
          where,
          include: PRODUCT_RELATIONS,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.db.product.count({ where }),
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

  async findOne(id: string): Promise<ProductResponseDto> {
    const product = await this.db.product.findUnique({
      where: { id },
      include: PRODUCT_RELATIONS,
    });
    if (!product) throw new NotFoundException('商品不存在');
    return toResponse(product);
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    if (Object.values(dto).every((value) => value === undefined))
      throw new BadRequestException('请至少提供一个可更新字段');
    await this.requireOwner(id, userId);
    if (dto.categoryId !== undefined)
      await this.requireCategory(dto.categoryId);
    try {
      // Include ownership in the write condition as well as the human-readable permission check.
      return toResponse(
        await this.db.product.update({
          where: { id, userId },
          data: {
            name: dto.name,
            description: dto.description,
            price: dto.price,
            stock: dto.stock,
            categoryId: dto.categoryId,
          },
          include: PRODUCT_RELATIONS,
        }),
      );
    } catch (error) {
      return this.handleWriteError(error);
    }
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.requireOwner(id, userId);
    try {
      await this.db.product.delete({ where: { id, userId } });
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  private async requireOwner(id: string, userId: string): Promise<void> {
    const product = await this.db.product.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.userId !== userId)
      throw new ForbiddenException('只能修改或删除自己创建的商品');
  }

  private async requireCategory(id: string): Promise<void> {
    if (
      !(await this.db.category.findUnique({
        where: { id },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException('所选分类不存在');
    }
  }

  private handleWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') throw new NotFoundException('商品不存在');
      if (error.code === 'P2003')
        throw new BadRequestException('关联分类或用户不存在，请刷新后重试');
    }
    throw error;
  }
}
