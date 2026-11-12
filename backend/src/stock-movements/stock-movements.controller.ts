import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequirePermissions } from '../auth/permissions.js';
import {
  GlobalStockMovementQueryDto,
  StockMovementPageDto,
  StockMovementQueryDto,
} from './dto/stock-movement.dto.js';
import { StockMovementsService } from './stock-movements.service.js';
@ApiTags('库存流水')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: '请先登录' })
@ApiForbiddenResponse({ description: '没有库存或订单读取权限' })
@ApiBadRequestResponse({ description: '筛选或分页参数无效；拒绝内部归属字段' })
@ApiNotFoundResponse({ description: '资源不存在或不在可访问范围内' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class StockMovementsController {
  constructor(private readonly movements: StockMovementsService) {}
  @Get('stock-movements')
  @RequirePermissions('stock:read')
  @ApiOperation({ summary: '按库存权限范围查询库存流水' })
  @ApiOkResponse({ type: StockMovementPageDto })
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query() query: GlobalStockMovementQueryDto,
  ) {
    return this.movements.findAll(req.user, query);
  }
  @Get('products/:id/stock-movements')
  @RequirePermissions('stock:read')
  @ApiOperation({ summary: '查询商品库存流水，OWN 按商品创建者限制' })
  @ApiOkResponse({ type: StockMovementPageDto })
  findProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Query() query: StockMovementQueryDto,
  ) {
    return this.movements.findProduct(id, req.user, query);
  }
  @Get('orders/:id/stock-movements')
  @RequirePermissions('stock:read', 'order:read')
  @ApiOperation({ summary: '在订单和库存权限范围交集中查询关联流水' })
  @ApiOkResponse({ type: StockMovementPageDto })
  findOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Query() query: StockMovementQueryDto,
  ) {
    return this.movements.findOrder(id, req.user, query);
  }
}
