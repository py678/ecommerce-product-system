import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  providers: [
    ThrottlerGuard,
    { provide: APP_GUARD, useExisting: ThrottlerGuard },
  ],
})
export class AppModule {}
