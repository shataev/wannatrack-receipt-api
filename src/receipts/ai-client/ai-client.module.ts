import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiClientService } from './ai-client.service';
import { LocalAnalyzerService } from './local-analyzer.service';
import { RECEIPT_ANALYZER, ReceiptAnalyzer } from './receipt-analyzer.interface';

@Module({
  imports: [ConfigModule],
  providers: [
    AiClientService,
    LocalAnalyzerService,
    {
      provide: RECEIPT_ANALYZER,
      useFactory: (
        aiClient: AiClientService,
        localAnalyzer: LocalAnalyzerService,
        config: ConfigService,
      ): ReceiptAnalyzer =>
        config.get<string>('AI_SERVICE_URL') ? aiClient : localAnalyzer,
      inject: [AiClientService, LocalAnalyzerService, ConfigService],
    },
  ],
  exports: [RECEIPT_ANALYZER],
})
export class AiClientModule {}
