import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommerceModule } from '../commerce/commerce.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';
@Module({
  imports: [DatabaseModule, AuthModule, CommerceModule, RealtimeModule],
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
