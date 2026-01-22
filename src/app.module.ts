import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReceiptsModule } from './receipts/receipts.module';
import { AiClientModule } from './receipts/ai-client/ai-client.module';
import { TelegramBotModule } from './telegram-bot/telegram-bot.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ReceiptsModule,
    AiClientModule,
    TelegramBotModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
