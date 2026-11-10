import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';
import { PERMISSION_KEY, type Permission } from './permissions.js';
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    // Missing metadata fails closed on controllers that opt into this guard.
    if (
      !required?.length ||
      !user ||
      !required.every((p) => user.permissions?.includes(p))
    )
      throw new ForbiddenException('没有执行此操作的权限');
    return true;
  }
}
