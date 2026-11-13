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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { CategoriesService } from './categories.service.js';
import {
  CategoryPageDto,
  CategoryQueryDto,
  CategoryResponseDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/category.dto.js';

@ApiTags('分类')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: '没有执行此操作的权限' })
@ApiUnauthorizedResponse({ description: '请先登录' })
@ApiBadRequestResponse({ description: '输入或分页参数无效' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Post()
  @ApiOperation({ summary: '创建共享分类' })
  @ApiCreatedResponse({ type: CategoryResponseDto })
  @RequirePermissions('category:create')
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Get()
  @ApiOperation({ summary: '分页搜索分类，可按有商品/无商品筛选' })
  @ApiOkResponse({ type: CategoryPageDto })
  @RequirePermissions('category:read')
  findAll(@Query() query: CategoryQueryDto) {
    return this.categories.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取分类详情及商品数量' })
  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiNotFoundResponse({ description: '分类不存在' })
  @RequirePermissions('category:read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '编辑分类' })
  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiNotFoundResponse({ description: '分类不存在' })
  @RequirePermissions('category:update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除未被商品引用的分类' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: '分类不存在' })
  @ApiConflictResponse({ description: '分类仍被商品引用' })
  @RequirePermissions('category:delete')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.remove(id);
  }
}
