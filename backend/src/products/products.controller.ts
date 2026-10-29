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
@ApiBadRequestResponse({ description: '输入、分页参数或分类无效' })
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @ApiOperation({ summary: '创建商品，创建者自动设为当前用户' })
  @ApiCreatedResponse({ type: ProductResponseDto })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateProductDto) {
    return this.products.create(request.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '分页搜索商品，可按分类筛选' })
  @ApiOkResponse({ type: ProductPageDto })
  findAll(@Query() query: ProductQueryDto) {
    return this.products.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '查看商品详情' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiNotFoundResponse({ description: '商品不存在' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '编辑自己创建的商品' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiForbiddenResponse({ description: '商品属于其他用户' })
  @ApiNotFoundResponse({ description: '商品不存在' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(id, request.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除自己创建的商品' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: '商品属于其他用户' })
  @ApiNotFoundResponse({ description: '商品不存在' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.products.remove(id, request.user.id);
  }
}
