import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalkEdge } from './walk-edge.entity';
import { WalkNode } from './walk-node.entity';
import { WalkController } from './walk.controller';
import { WalkService } from './walk.service';

@Module({
  imports: [MikroOrmModule.forFeature([WalkNode, WalkEdge]), AuthModule],
  controllers: [WalkController],
  providers: [WalkService],
})
export class WalkModule {}
