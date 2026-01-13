import { Module } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { ReceiptsController } from './receipts.controller';
import { AiClientService } from './ai-client/ai-client.service';

@Module({
  providers: [ReceiptsService, AiClientService],
  controllers: [ReceiptsController]
})
export class ReceiptsModule {}
