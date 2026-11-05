import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequirePermissions } from '../auth/permissions.js';
import {
  CancelOrderDto,
  CreateOrderDto,
  OrderDetailDto,
  OrderPageDto,
  OrderQueryDto,
  ShipOrderDto,
} from './dto/order.dto.js';
import { OrdersService } from './orders.service.js';
class EmptyOrderBodyPipe {
  transform(value: unknown) {
    if (value === undefined) return {};
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length
    )
      throw new BadRequestException('此操作不接受任何字段');
    return value;
  }
}
@ApiTags('订单')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBadRequestResponse({ description: '输入无效或非白名单字段' })
@ApiUnauthorizedResponse({ description: '请先登录' })
@ApiForbiddenResponse({ description: '无权限' })
@ApiNotFoundResponse({ description: '订单不存在' })
@ApiConflictResponse({ description: '库存、幂等键或状态冲突' })
@ApiServiceUnavailableResponse({ description: '副本禁止写入' })
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Post()
  @RequirePermissions('order:create')
  @ApiOperation({ summary: '录单并原子扣库存；同键同内容幂等重试' })
  @ApiCreatedResponse({ type: OrderDetailDto })
  create(@Req() r: AuthenticatedRequest, @Body() dto: CreateOrderDto) {
    return this.orders.create(r.user, dto);
  }
  @Get()
  @RequirePermissions('order:read')
  @ApiOperation({ summary: '自己的订单；管理员全部，列表与总数同范围' })
  @ApiOkResponse({ type: OrderPageDto })
  list(@Req() r: AuthenticatedRequest, @Query() q: OrderQueryDto) {
    return this.orders.findAll(r.user, q);
  }
  @Get(':id')
  @RequirePermissions('order:read')
  @ApiOperation({ summary: '订单详情与快照、操作日志' })
  @ApiOkResponse({ type: OrderDetailDto })
  get(@Param('id', ParseUUIDPipe) id: string, @Req() r: AuthenticatedRequest) {
    return this.orders.findOne(id, r.user);
  }
  @ApiBody({
    schema: { type: 'object', properties: {}, additionalProperties: false },
  })
  @Patch(':id/confirm')
  @RequirePermissions('order:confirm')
  @ApiOperation({ summary: '创建人或管理员手动确认 PENDING，不代表支付' })
  @ApiOkResponse({ type: OrderDetailDto })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: AuthenticatedRequest,
    @Body(new EmptyOrderBodyPipe()) _dto: Record<string, never>,
  ) {
    void _dto;
    return this.orders.transition(id, r.user, 'confirm');
  }
  @Patch(':id/ship')
  @RequirePermissions('order:ship')
  @ApiOperation({ summary: 'CONFIRMED 发货，必须填写物流与运单号' })
  @ApiOkResponse({ type: OrderDetailDto })
  ship(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: AuthenticatedRequest,
    @Body() dto: ShipOrderDto,
  ) {
    return this.orders.transition(id, r.user, 'ship', dto);
  }
  @ApiBody({
    schema: { type: 'object', properties: {}, additionalProperties: false },
  })
  @Patch(':id/complete')
  @RequirePermissions('order:complete')
  @ApiOperation({ summary: '创建人或管理员手动完成 SHIPPED' })
  @ApiOkResponse({ type: OrderDetailDto })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: AuthenticatedRequest,
    @Body(new EmptyOrderBodyPipe()) _dto: Record<string, never>,
  ) {
    void _dto;
    return this.orders.transition(id, r.user, 'complete');
  }
  @Patch(':id/cancel')
  @RequirePermissions('order:cancel')
  @ApiOperation({
    summary: '仅 PENDING/CONFIRMED 可取消并回补一次；发货后禁止',
  })
  @ApiOkResponse({ type: OrderDetailDto })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: AuthenticatedRequest,
    @Body() dto: CancelOrderDto,
  ) {
    return this.orders.transition(id, r.user, 'cancel', dto);
  }
}
