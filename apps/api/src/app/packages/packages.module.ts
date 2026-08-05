import { Module } from '@nestjs/common';
import { PackagesController } from './packages.controller';
import { PackagesRepository } from './packages.repository';

@Module({
  controllers: [PackagesController],
  providers: [PackagesRepository],
})
export class PackagesModule {}
