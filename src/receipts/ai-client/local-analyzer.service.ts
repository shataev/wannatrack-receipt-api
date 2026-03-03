import { Injectable } from '@nestjs/common';
import { ReceiptResultDto } from '../dto/receipt-result.dto';
import { ReceiptAnalyzer } from './receipt-analyzer.interface';

/**
 * In-process stub analyzer. Used when AI_SERVICE_URL is not set (e.g. local dev without Python).
 */
@Injectable()
export class LocalAnalyzerService implements ReceiptAnalyzer {
  async analyzeText(_text: string): Promise<ReceiptResultDto> {
    return this.stubResult('text');
  }

  async analyzeFile(_file: Express.Multer.File): Promise<ReceiptResultDto> {
    return this.stubResult('receipt');
  }

  private stubResult(type: 'receipt' | 'text'): ReceiptResultDto {
    return {
      type,
      merchant: null,
      total: 0,
      currency: 'RUB',
      date: new Date().toISOString(),
      items: [],
      confidence: 0,
      language: 'ru',
    };
  }
}
