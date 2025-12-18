import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tenantHeader = request.headers['x-tenant-id'] as string | undefined;

    if (!tenantHeader) {
      throw new UnauthorizedException('Missing X-Tenant-Id header');
    }

    request.tenantId = tenantHeader;
    return true;
  }
}


