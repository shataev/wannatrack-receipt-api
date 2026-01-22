import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Context } from 'telegraf';
import axios from 'axios';
import FormData from 'form-data';

@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly apiBaseUrl: string;
  private readonly telegramToken: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    // Use local API endpoint - adjust if your API runs on different host/port
    this.apiBaseUrl = this.configService.get<string>('API_BASE_URL') || 'http://localhost:3000';
    this.telegramToken = this.configService.get<string>('TG_TOKEN') || '';
  }

  /**
   * Handle text messages from Telegram
   * @param chatId - Telegram chat ID (user identifier)
   * @param text - Text message content
   * @returns Structured expense information
   */
  async handleText(chatId: number, text: string): Promise<any> {
    try {
      this.logger.log(`Processing text message from user ${chatId}`);

      const formData = new FormData();
      formData.append('text', text);

      const response$ = this.httpService.post(
        `${this.apiBaseUrl}/receipts/analyze`,
        formData,
        {
          headers: formData.getHeaders(),
        },
      );

      const { data } = await firstValueFrom(response$);
      return data;
    } catch (error) {
      this.logger.error(`Error processing text message: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle photo messages from Telegram
   * Downloads the photo and sends it to the API
   * @param ctx - Telegraf context
   * @returns Structured expense information
   */
  async handlePhoto(ctx: Context): Promise<any> {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      throw new Error('Chat ID not found');
    }

    try {
      this.logger.log(`Processing photo message from user ${chatId}`);

      if (!ctx.message || !('photo' in ctx.message)) {
        throw new Error('No photo found in the message');
      }

      const photos = ctx.message.photo;
      if (!photos || photos.length === 0) {
        throw new Error('No photo found in the message');
      }

      // Get the largest photo (last element in the array)
      const largestPhoto = photos[photos.length - 1];
      const fileId = largestPhoto.file_id;

      // Get file information from Telegram
      const file = await ctx.telegram.getFile(fileId);
      const filePath = file.file_path;

      if (!filePath) {
        throw new Error('File path not available');
      }

      // Download the file from Telegram
      const downloadUrl = `https://api.telegram.org/file/bot${this.telegramToken}/${filePath}`;
      const fileResponse = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
      });

      // Create FormData to send to API
      const formData = new FormData();
      formData.append('file', Buffer.from(fileResponse.data), {
        filename: filePath.split('/').pop() || 'receipt.jpg',
        contentType: 'image/jpeg',
      });

      // Send to API
      const response$ = this.httpService.post(
        `${this.apiBaseUrl}/receipts/analyze`,
        formData,
        {
          headers: formData.getHeaders(),
        },
      );

      const { data } = await firstValueFrom(response$);
      return data;
    } catch (error) {
      this.logger.error(`Error processing photo message: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Format expense result for Telegram message
   * @param result - Expense result from API
   * @returns Formatted message string
   */
  formatExpenseResult(result: any): string {
    if (!result) {
      return '❌ Could not extract expense information.';
    }

    const { total, currency, merchant, confidence } = result;
    console.log('result', result)

    let message = '✅ Expense extracted:\n\n';
    
    if (merchant) {
      message += `🏪 Merchant: ${merchant}\n`;
    }
    
    if (total) {
      message += `💰 Amount: ${total} ${currency || 'RUB'}\n`;
    }
    
    if (confidence !== undefined) {
      message += `📊 Confidence: ${(confidence * 100).toFixed(1)}%\n`;
    }

    return message;
  }
}

