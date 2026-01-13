import { Injectable } from '@nestjs/common';
import { ReceiptResultDto } from './dto/receipt-result.dto';
import { AiClientService } from './ai-client/ai-client.service';

@Injectable()
export class ReceiptsService {
  constructor(private readonly aiClientService: AiClientService) {}
  
  async analyze(file: Express.Multer.File): Promise<ReceiptResultDto> {
    return this.aiClientService.processReceipt(file);
  }
}