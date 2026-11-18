import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { StaffAuthGuard } from '../auth/staff-auth.guard';
import {
  type WalkEdgeView,
  type WalkGraphView,
  type WalkRouteView,
  WalkService,
} from './walk.service';

/**
 * Shoppers read the walk graph without an account; every change requires
 * a signed-in staff session (StaffAuthGuard on all three mutations).
 */
@Controller()
export class WalkController {
  constructor(private readonly walk: WalkService) {}

  @Get('walk-graph')
  graph(): Promise<WalkGraphView> {
    return this.walk.graph();
  }

  /** Public: shortest walks and visiting order for the shopper's products. */
  @Post('walk/route')
  planRoute(@Body() body: unknown): Promise<WalkRouteView> {
    return this.walk.planRoute(body);
  }

  @Post('walk/edges')
  @UseGuards(StaffAuthGuard)
  addEdge(@Body() body: unknown): Promise<WalkEdgeView> {
    return this.walk.addEdge(body);
  }

  @Post('walk/edges/:id/blocked')
  @UseGuards(StaffAuthGuard)
  setBlocked(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WalkEdgeView> {
    return this.walk.setEdgeBlocked(Number(id), body);
  }

  @Delete('walk/edges/:id')
  @UseGuards(StaffAuthGuard)
  removeEdge(@Param('id') id: string): Promise<{ ok: true }> {
    return this.walk.removeEdge(Number(id));
  }
}
