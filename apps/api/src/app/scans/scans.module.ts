import { Module } from '@nestjs/common';
import { FindingsModule } from '../findings/findings.module';
import { ProjectsModule } from '../projects/projects.module';
import { ScansController } from './scans.controller';
import { ScansRepository } from './scans.repository';
import { ScansService } from './scans.service';

@Module({
  imports: [ProjectsModule, FindingsModule],
  controllers: [ScansController],
  providers: [ScansService, ScansRepository],
})
export class ScansModule {}
