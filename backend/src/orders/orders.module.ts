import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommerceModule } from '../commerce/commerce.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
@Module({
  imports: [AuthModule, CommerceModule, DatabaseModule, RealtimeModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
