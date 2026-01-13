import { Module } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';

@Module({
  providers: [ReceiptsService]
})
export class ReceiptsModule {}
