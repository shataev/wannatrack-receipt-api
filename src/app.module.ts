import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReceiptsModule } from './receipts/receipts.module';
import { AiClientModule } from './receipts/ai-client/ai-client.module';

@Module({
  imports: [ReceiptsModule, AiClientModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
