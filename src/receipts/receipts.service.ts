import { Injectable } from '@nestjs/common';
import { ReceiptResultDto } from './dto/receipt-result.dto';

@Injectable()
export class ReceiptsService {
  async analyze(file: Express.Multer.File): Promise<ReceiptResultDto> {
    return {
      amount: 123.45,
      currency: 'THB',
      merchant: 'Demo Store',
      confidence: 0.95,
    };
  }
}