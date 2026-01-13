import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReceiptsModule } from './receipts/receipts.module';

@Module({
  imports: [ReceiptsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
