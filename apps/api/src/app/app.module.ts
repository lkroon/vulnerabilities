import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DynamoModule } from './dynamo/dynamo.module';
import { PackagesModule } from './packages/packages.module';
import { ProjectsModule } from './projects/projects.module';
import { ScansModule } from './scans/scans.module';

/**
 * One feature module per bounded area, each owning its controller, service and
 * repository. `DynamoModule` is imported once and is `@Global`, so the document
 * client is created once per process rather than per module.
 */
@Module({
  imports: [DynamoModule, ProjectsModule, ScansModule, PackagesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
