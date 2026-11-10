import { OrdersModule } from './orders/orders.module.js';
import { RolesModule } from './roles/roles.module.js';
import { AdminModule } from './admin/admin.module.js';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ProductsModule } from './products/products.module.js';
import { UsersModule } from './users/users.module.js';
import { UploadModule } from './upload/upload.module.js';

@Module({
  imports: [
    RolesModule,
    OrdersModule,
    AdminModule,
    DatabaseModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    UploadModule,
    UsersModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  providers: [
    ThrottlerGuard,
    { provide: APP_GUARD, useExisting: ThrottlerGuard },
  ],
})
export class AppModule {}
