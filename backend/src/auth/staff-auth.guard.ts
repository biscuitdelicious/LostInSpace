import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService, StaffAccountView } from './auth.service';

export type StaffAuthenticatedRequest = {
  headers?: { authorization?: string | string[] };
  staffUser?: StaffAccountView;
};

export function extractBearerToken(
  authorization?: string | string[],
): string | null {
  const header = Array.isArray(authorization)
    ? authorization[0]
    : authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<StaffAuthenticatedRequest>();
    const token = extractBearerToken(request.headers?.authorization);
    if (!token) {
      throw new UnauthorizedException('Staff sign-in required');
    }
    request.staffUser = await this.auth.authenticate(token);
    return true;
  }
}
