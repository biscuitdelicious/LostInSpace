import path from 'node:path';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import mikroOrmConfig from './mikro-orm.config';
import { ProductsModule } from './products/products.module';
import { ReportsModule } from './reports/reports.module';
import { WalkModule } from './walk/walk.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        '.env',
        '../.env',
        path.resolve(__dirname, '../.env'),
        path.resolve(__dirname, '../../.env'),
      ],
    }),
    MikroOrmModule.forRoot(mikroOrmConfig),
    AuthModule,
    ProductsModule,
    ReportsModule,
    WalkModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
