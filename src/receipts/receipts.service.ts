import { Injectable } from '@nestjs/common';
import { AiClientService } from './ai-client/ai-client.service';
import { ReceiptResultDto } from './dto/receipt-result.dto';
import { Express } from 'express';

@Injectable()
export class ReceiptsService {
  constructor(private readonly aiClient: AiClientService) {}

  analyzeText(text: string): Promise<ReceiptResultDto> {
    return this.aiClient.analyzeText(text);
  }

  analyzeFile(file: Express.Multer.File): Promise<ReceiptResultDto> {
    return this.aiClient.analyzeFile(file);
  }
}