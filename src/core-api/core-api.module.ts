import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { CoreApiService } from './core-api.service';

@Module({
  imports: [ConfigModule, HttpModule],
  providers: [CoreApiService],
  exports: [CoreApiService],
})
export class CoreApiModule {}
