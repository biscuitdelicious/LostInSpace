import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthService, StaffAccountView, StaffLoginView } from './auth.service';
import {
  extractBearerToken,
  StaffAuthGuard,
  type StaffAuthenticatedRequest,
} from './staff-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Headers('x-device-token') deviceToken?: string | string[],
    @Res({ passthrough: true })
    response?: {
      setHeader(name: string, value: string): unknown;
    },
  ): Promise<StaffLoginView> {
    try {
      return await this.auth.login(body, firstHeader(deviceToken));
    } catch (error) {
      // Locked-out callers also get the standard Retry-After header.
      if (error instanceof HttpException && error.getStatus() === 429) {
        const payload = error.getResponse() as { retryAfterSeconds?: number };
        if (typeof payload.retryAfterSeconds === 'number') {
          response?.setHeader('Retry-After', String(payload.retryAfterSeconds));
        }
      }
      throw error;
    }
  }

  /**
   * Also hands back a device trust token, so a phone that was already
   * signed in (or whose token was issued under an older secret) becomes a
   * trusted device without having to type the password again.
   */
  @Get('me')
  @UseGuards(StaffAuthGuard)
  me(
    @Req() request: StaffAuthenticatedRequest,
    @Headers('x-device-token') deviceToken?: string | string[],
  ): { user: StaffAccountView; deviceToken: string } {
    const user = request.staffUser!;
    return {
      user,
      deviceToken: this.auth.deviceTokenFor(
        user.username,
        firstHeader(deviceToken),
      ),
    };
  }

  @Post('logout')
  @HttpCode(200)
  logout(
    @Headers('authorization') authorization?: string | string[],
  ): Promise<{ ok: true }> {
    return this.auth.logout(extractBearerToken(authorization));
  }
}

function firstHeader(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
