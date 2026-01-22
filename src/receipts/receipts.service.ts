import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data';
import * as chrono from 'chrono-node';
import { ru, en } from 'chrono-node';
import { ReceiptResultDto } from './dto/receipt-result.dto';

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(private readonly http: HttpService) {}

  private readonly AI_URL = 'http://127.0.0.1:8000/analyze';

  async analyzeText(text: string): Promise<ReceiptResultDto> {
    const form = new FormData();
    form.append('text', text);

    const response$ = this.http.post(this.AI_URL, form, {
      headers: form.getHeaders(),
    });

    const { data } = await firstValueFrom(response$);
    return this.normalizeReceiptResult(data);
  }

  async analyzeFile(file: Express.Multer.File): Promise<ReceiptResultDto> {
    const form = new FormData();
    form.append('file', file.buffer, file.originalname);

    const response$ = this.http.post(this.AI_URL, form, {
      headers: form.getHeaders(),
    });

    const { data } = await firstValueFrom(response$);
    return this.normalizeReceiptResult(data);
  }

  /**
   * Normalize receipt result from AI service
   * Parses and normalizes date field to ISO format
   * @param result - Raw result from AI service
   * @returns Normalized receipt result
   */
  private normalizeReceiptResult(result: any): ReceiptResultDto {
    const normalized = { ...result };
    console.log('result', result)

    // Normalize date if present
    if (normalized.date) {
      normalized.date = this.normalizeDate(normalized.date, normalized.language);
    }

    return normalized as ReceiptResultDto;
  }

  /**
   * Normalize date string to ISO format
   * Parses date using chrono-node to support natural language dates
   * @param dateString - Date string in various formats (ISO, natural language, etc.)
   * @param language - Language code (e.g., 'en', 'ru') for better parsing accuracy
   * @returns ISO date string or null if parsing failed
   */
  private normalizeDate(dateString: string, language?: string): string | null {
    try {
      const parsedDate = this.parseDate(dateString, language);

      if (!parsedDate) {
        this.logger.warn(`Could not parse date: ${dateString}`);
        return null;
      }

      // Return ISO format string
      return parsedDate.toISOString();
    } catch (error) {
      this.logger.warn(`Failed to normalize date: ${dateString}`, error);
      return null;
    }
  }

  /**
   * Parse date string using chrono-node to support natural language dates
   * Supports formats like: "yesterday", "2 days ago", "last week", "позавчера", "неделю назад", etc.
   * @param dateString - Date string in various formats (ISO, natural language, etc.)
   * @param language - Language code (e.g., 'en', 'ru'). Used to select appropriate chrono parser
   * @returns Parsed Date object or null if parsing failed
   */
  private parseDate(dateString: string, language?: string): Date | null {
    try {
      // Try parsing with chrono-node (supports natural language)
      // chrono-node automatically detects language or can use locale-specific parsers
      let parsed: Date | null = null;
      console.log('dateString', dateString);

      if (language) {
        const langCode = language.toLowerCase();

        // Try locale-specific parser first for better accuracy
        if (langCode === 'ru') {
          parsed = ru.parseDate(dateString);
        } else if (langCode === 'en') {
          parsed = en.parseDate(dateString);
        }
      }

      // If locale-specific parser didn't work or no locale provided, use default parser
      // Default parser tries to detect language automatically
      if (!parsed) {
        parsed = chrono.parseDate(dateString);
      }

      if (parsed) {
        return parsed;
      }

      // Fallback to standard Date parsing for ISO formats
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