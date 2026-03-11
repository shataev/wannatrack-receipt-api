import { Inject, Injectable, Logger } from '@nestjs/common';
import * as chrono from 'chrono-node';
import { en, ru } from 'chrono-node';
import { ReceiptResultDto } from './dto/receipt-result.dto';
import { RECEIPT_ANALYZER } from './ai-client/receipt-analyzer.interface';
import type { ReceiptAnalyzer } from './ai-client/receipt-analyzer.interface';

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    @Inject(RECEIPT_ANALYZER) private readonly analyzer: ReceiptAnalyzer,
  ) {}

  async analyzeText(text: string): Promise<ReceiptResultDto> {
    const raw = await this.analyzer.analyzeText(text);

    console.log('raw', raw);
    console.log(this.normalizeReceiptResult(raw));

    return this.normalizeReceiptResult(raw);
  }

  async analyzeFile(file: Express.Multer.File): Promise<ReceiptResultDto> {
    const raw = await this.analyzer.analyzeFile(file);
    return this.normalizeReceiptResult(raw);
  }

  /**
   * Normalize receipt result from analyzer.
   * Parses and normalizes date field to ISO format.
   */
  private normalizeReceiptResult(result: any): ReceiptResultDto {
    const normalized = { ...result };

    if (normalized.date) {
      normalized.date = this.normalizeDate(normalized.date, normalized.language);
    }

    return normalized as ReceiptResultDto;
  }

  private normalizeDate(dateString: string, language?: string): string | null {
    console.log('dateString', dateString);
    console.log('language', language);
    try {
      const parsedDate = this.parseDate(dateString, language);

      console.log('parsedDate', parsedDate);

      if (!parsedDate) {
        this.logger.warn(`Could not parse date: ${dateString}`);
        return null;
      }

      return parsedDate.toISOString();
    } catch (error) {
      this.logger.warn(`Failed to normalize date: ${dateString}`, error);
      return null;
    }
  }

  private parseDate(dateString: string, language?: string): Date | null {
    try {
      let parsed: Date | null = null;

      if (language) {
        const langCode = language.toLowerCase();
        if (langCode === 'ru') {
          parsed = ru.parseDate(dateString);
        } else if (langCode === 'en') {
          parsed = en.parseDate(dateString);
        }
      }

      if (!parsed) {
        parsed = chrono.parseDate(dateString);
      }

      if (parsed) {
        return parsed;
      }

      const standardDate = new Date(dateString);
      if (!isNaN(standardDate.getTime())) {
        return standardDate;
      }

      return null;
    } catch (error) {
      this.logger.warn(`Failed to parse date: ${dateString}`, error);
      return null;
    }
  }
}
