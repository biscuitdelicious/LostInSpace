import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DeviceTrust } from './device-trust';
import { LoginThrottle } from './login-throttle';
import { StaffAuthGuard } from './staff-auth.guard';
import { StaffSession } from './staff-session.entity';
import { StaffUser } from './staff-user.entity';

@Module({
  imports: [MikroOrmModule.forFeature([StaffUser, StaffSession])],
  controllers: [AuthController],
  providers: [AuthService, LoginThrottle, DeviceTrust, StaffAuthGuard],
  exports: [AuthService, StaffAuthGuard],
})
export class AuthModule {}
