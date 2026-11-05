import { CommerceAuthorityService } from '../commerce/commerce.module.js';
import {
  RealtimeService,
  notifyResourceChange,
} from '../realtime/realtime.service.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { productScope, type Actor } from '../auth/permissions.js';
import { lowStockThreshold } from './products.config.js';
import { productListQuery } from './product-list-query.js';
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
  private readonly threshold = lowStockThreshold();
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService,
    private readonly authority: CommerceAuthorityService,
  ) {}

  async create(
    userId: string,
    dto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    await this.authority.requireWriter();
    await this.requireCategory(dto.categoryId);
    try {
      const response = toResponse(
        await this.db.product.create({
          data: {
            userId,
            categoryId: dto.categoryId,
            name: dto.name,
            description: dto.description,
            coverImage: dto.coverImage === '' ? null : dto.coverImage,
            price: dto.price,
            stock: dto.stock,
          },
          include: PRODUCT_RELATIONS,
        }),
      );
      notifyResourceChange(this.realtime, 'product', response.id, 'created');
      return response;
    } catch (error) {
      return this.handleWriteError(error);
    }
  }

  async findAll(query: ProductQueryDto): Promise<ProductPageDto> {
    const filters = productListQuery(query, this.threshold);
    const where: Prisma.ProductWhereInput = {
      ...filters.where,
    };
    const orderBy = filters.orderBy;
    const [items, total] = await this.db.$transaction(
      [
        this.db.product.findMany({
          where,
          include: PRODUCT_RELATIONS,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.db.product.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const list = items.map(toResponse);
    return {
      list,
      items: list,
      lowStockThreshold: this.threshold,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async findOne(id: string): Promise<ProductResponseDto> {
    return this.findInScope(id, {});
  }

  private async findInScope(
    id: string,
    scope: Prisma.ProductWhereInput,
  ): Promise<ProductResponseDto> {
    const product = await this.db.product.findUnique({
      where: { ...scope, id },
      include: PRODUCT_RELATIONS,
    });
    if (!product) throw new NotFoundException('商品不存在');
    return toResponse(product);
  }

  async update(
    id: string,
    actor: Actor,
    dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    await this.authority.requireWriter();
    if (dto.stock !== undefined && dto.stockVersion === undefined)
      throw new BadRequestException('修改库存必须提供 stockVersion');
    if (
      Object.entries(dto)
        .filter(([key]) => key !== 'stockVersion')
        .every(([, value]) => value === undefined)
    )
      throw new BadRequestException('请至少提供一个可更新字段');
    await this.findInScope(id, productScope(actor));
    if (dto.categoryId !== undefined)
      await this.requireCategory(dto.categoryId);
    try {
      // Include ownership in the write condition as well as the human-readable permission check.
      const response = toResponse(
        await this.db.product.update({
          where: {
            ...productScope(actor),
            id,
            ...(dto.stock !== undefined
              ? { stockVersion: dto.stockVersion }
              : {}),
          },
          data: {
            name: dto.name,
            description: dto.description,
            coverImage: dto.coverImage === '' ? null : dto.coverImage,
            price: dto.price,
            stock: dto.stock,
            categoryId: dto.categoryId,
          },
          include: PRODUCT_RELATIONS,
        }),
      );
      notifyResourceChange(this.realtime, 'product', response.id, 'updated');
      return response;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025' &&
        dto.stock !== undefined
      ) {
        await this.findInScope(id, productScope(actor));
        throw new ConflictException('库存已变化，请重新打开商品后编辑');
      }
      return this.handleWriteError(error);
    }
  }

  async remove(id: string, actor: Actor): Promise<void> {
    await this.authority.requireWriter();
    await this.findInScope(id, productScope(actor));
    try {
      await this.db.product.delete({ where: { ...productScope(actor), id } });
      notifyResourceChange(this.realtime, 'product', id, 'deleted');
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      )
        throw new ConflictException('商品已被订单引用，不能删除');
      this.handleWriteError(error);
    }
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
