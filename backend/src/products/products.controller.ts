import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequirePermissions } from '../auth/permissions.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import { ProductsService } from './products.service.js';
import {
  CreateProductDto,
  ProductPageDto,
  ProductQueryDto,
  ProductResponseDto,
  UpdateProductDto,
} from './dto/product.dto.js';

@ApiTags('商品')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: '请先登录' })
@ApiBadRequestResponse({
  description: '输入、分页参数或分类无效；拒绝归属及角色字段',
})
@ApiForbiddenResponse({ description: '没有执行此操作的权限' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @ApiOperation({ summary: '创建商品，创建者自动设为当前用户' })
  @ApiCreatedResponse({ type: ProductResponseDto })
  @RequirePermissions('product:create')
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateProductDto) {
    return this.products.create(request.user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: '商品筛选排序；管理员访问全部，其余仅自己，列表与总数同范围',
  })
  @ApiOkResponse({ type: ProductPageDto })
  @RequirePermissions('product:read')
  findAll(
    @Query() query: ProductQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.products.findAll(query, request.user);
  }

  @Get(':id')
  @ApiOperation({ summary: '查看商品详情' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiNotFoundResponse({ description: '商品不存在或不在可访问范围内' })
  @RequirePermissions('product:read')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.products.findOne(id, request.user);
  }

  @Patch(':id')
  @ApiOperation({ summary: '编辑商品；管理员可编辑全部，其余仅自己' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiForbiddenResponse({ description: '没有执行此操作的权限' })
  @ApiNotFoundResponse({ description: '商品不存在或不在可访问范围内' })
  @RequirePermissions('product:update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(id, request.user, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除商品；管理员可删除全部，其余仅自己' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: '没有执行此操作的权限' })
  @ApiNotFoundResponse({ description: '商品不存在或不在可访问范围内' })
  @RequirePermissions('product:delete')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.products.remove(id, request.user);
  }
}
