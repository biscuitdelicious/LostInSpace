import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { config } from './config/config.js';
import mikroOrmConfig from './mikro-orm.config.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
    UsersModule,
    AuthModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [config],
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
