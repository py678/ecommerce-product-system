import { AccessTokenService } from './access-token.service.js';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JWT_AUDIENCE, JWT_ISSUER, readAuthConfig } from './auth.config.js';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const config = readAuthConfig();
        return {
          secret: config.secret,
          signOptions: {
            algorithm: 'HS256',
            expiresIn: config.expiresInSeconds,
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
          },
          verifyOptions: {
            algorithms: ['HS256'],
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AccessTokenService, AuthService, JwtAuthGuard, PermissionsGuard],
  exports: [
    AccessTokenService,
    AuthService,
    JwtAuthGuard,
    JwtModule,
    PermissionsGuard,
  ],
})
export class AuthModule {}
