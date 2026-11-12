import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { StockMovementsController } from './stock-movements.controller.js';
import { StockMovementsService } from './stock-movements.service.js';
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [StockMovementsController],
  providers: [StockMovementsService],
})
export class StockMovementsModule {}
