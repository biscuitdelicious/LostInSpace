import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { Product } from '../products/product.entity';
import { LocationReportsController } from './location-reports.controller';
import { LocationReportsService } from './location-reports.service';
import { ProductReport } from './product-report.entity';

@Module({
  imports: [MikroOrmModule.forFeature([ProductReport, Product]), AuthModule],
  controllers: [LocationReportsController],
  providers: [LocationReportsService],
})
export class ReportsModule {}
