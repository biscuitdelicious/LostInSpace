import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StaffAuthGuard } from '../auth/staff-auth.guard';
import {
  LocationReportsService,
  LocationReportView,
} from './location-reports.service';

@Controller('product-reports')
export class LocationReportsController {
  constructor(private readonly reports: LocationReportsService) {}

  @Get()
  @UseGuards(StaffAuthGuard)
  list(
    @Query('status') status?: string | string[],
  ): Promise<LocationReportView[]> {
    const value = Array.isArray(status) ? status[0] : status;
    return this.reports.list(value);
  }

  @Post()
  create(@Body() body: unknown): Promise<LocationReportView> {
    return this.reports.create(body);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<LocationReportView> {
    return this.reports.get(Number(id));
  }

  @Post(':id/confirm')
  @UseGuards(StaffAuthGuard)
  confirm(@Param('id') id: string): Promise<LocationReportView> {
    return this.reports.confirm(Number(id));
  }

  @Post(':id/reject')
  @UseGuards(StaffAuthGuard)
  reject(@Param('id') id: string): Promise<LocationReportView> {
    return this.reports.reject(Number(id));
  }

  @Delete(':id')
  @UseGuards(StaffAuthGuard)
  remove(@Param('id') id: string): Promise<{ ok: true }> {
    return this.reports.remove(Number(id));
  }
}
