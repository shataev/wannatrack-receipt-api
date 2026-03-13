import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Context } from 'telegraf';
import axios from 'axios';
import FormData from 'form-data';
import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import {
  CoreApiService,
  CoreCategory,
  CoreFund,
  CreateCostPayload,
} from '../core-api/core-api.service';
import { ReceiptResultDto } from '../receipts/dto/receipt-result.dto';

export interface PendingExpense {
  amount: number;
  currency: string;
  comment?: string;
  date: string;
  userId: string;
  categoryId?: string;
}

@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly apiBaseUrl: string;
  private readonly baseUrl: string;
  private readonly telegramToken: string;

  private readonly botSecret: string;

  /** Pending expense per chat: after receipt recognition, before category/fund selection */
  private readonly pendingByChat = new Map<number, PendingExpense>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly coreApi: CoreApiService,
  ) {
    // Use local API endpoint - adjust if your API runs on different host/port
    this.apiBaseUrl = this.configService.get<string>('API_BASE_URL') || 'http://localhost:3000';
    this.baseUrl = this.configService.get<string>('BASE_URL') || 'http://localhost:3000';
    this.telegramToken = this.configService.get<string>('TG_TOKEN') || '';
    this.botSecret = this.configService.get<string>('TELEGRAM_BOT_SECRET') || '';
  }

  setPendingExpense(chatId: number, expense: PendingExpense): void {
    this.pendingByChat.set(chatId, expense);
  }

  getPendingExpense(chatId: number): PendingExpense | undefined {
    return this.pendingByChat.get(chatId);
  }

  clearPendingExpense(chatId: number): void {
    this.pendingByChat.delete(chatId);
  }

  getUserIdByTelegramId(telegramId: number): Promise<string | null> {
    return this.coreApi.getUserIdByTelegramId(telegramId);
  }

  getCategories(userId: string): Promise<CoreCategory[]> {
    return this.coreApi.getCategories(userId);
  }

  getFunds(userId: string): Promise<CoreFund[]> {
    return this.coreApi.getFunds(userId);
  }

  buildCategoryKeyboard(categories: CoreCategory[]): InlineKeyboardMarkup {
    const list = categories.slice(0, 20);
    const rows: Array<ReturnType<typeof Markup.button.callback>[]> = [];
    for (let i = 0; i < list.length; i += 2) {
      const row = [
        Markup.button.callback(list[i].name, 'cat_' + list[i].value),
      ];
      if (i + 1 < list.length) {
        row.push(Markup.button.callback(list[i + 1].name, 'cat_' + list[i + 1].value));
      }
      rows.push(row);
    }
    return Markup.inlineKeyboard(rows).reply_markup;
  }

  buildFundKeyboard(funds: CoreFund[]): InlineKeyboardMarkup {
    const buttons = funds.filter((fund) => fund.currentBalance > 0)
    .map((fund) => [
      Markup.button.callback(
        `${fund.name} - ${fund.currentBalance} ${fund.currency}`,
        'fund_' + fund._id,
      ),
    ]);
    buttons.push([Markup.button.callback('No account', 'fund_none')]);
    return Markup.inlineKeyboard(buttons).reply_markup;
  }

  async createCost(chatId: number, fundId: string | null): Promise<void> {
    const pending = this.getPendingExpense(chatId);
    if (!pending) throw new Error('No pending expense');

    const payload: CreateCostPayload = {
      amount: pending.amount,
      category: pending.categoryId!,
      comment: pending.comment,
      userId: pending.userId,
      date: pending.date,
    };
    
    if (fundId) {
      payload.fundId = fundId;
    } 

    await this.coreApi.createCost(payload);
    this.clearPendingExpense(chatId);
  }

  /**
   * Call backend to bind Telegram account to the user who created the binding link.
   * @param payload - Start payload from link, e.g. "bind_<token>"
   * @param telegramId - Telegram user id (from ctx.from.id)
   * @returns Success result or throws on error
   */
  async bindTelegramAccount(payload: string, telegramId: number): Promise<{ success: boolean; userId?: string }> {
    // Backend accepts token with or without "bind_" prefix
    const token = payload.trim();

    const response$ = this.httpService.post<{ success: boolean; userId?: string }>(
      `${this.apiBaseUrl}/api/telegram/telegram-bind`,
      { token, telegramId },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(this.botSecret && { 'X-Telegram-Bot-Secret': this.botSecret }),
        },
      },
    );

    const { data } = await firstValueFrom(response$);
    return data;
  }

  /**
   * Handle text messages from Telegram
   * @param chatId - Telegram chat ID (user identifier)
   * @param text - Text message content
   * @returns Structured expense information
   */
  async handleText(chatId: number, text: string): Promise<ReceiptResultDto> {
    try {
      this.logger.log(`Processing text message from user ${chatId}`);

      const formData = new FormData();
      formData.append('text', text);

      const response$ = this.httpService.post(
        `${this.baseUrl}/receipts/analyze`,
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
        `${this.baseUrl}/receipts/analyze`,
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
   * @param result - Expense result from API (ReceiptResultDto)
   * @returns Formatted message string
   */
  formatExpenseResult(result: ReceiptResultDto | null | undefined): string {
    if (!result) {
      return '❌ Could not extract expense information.';
    }

    const { total, currency, merchant, confidence, date } = result;

    let message = '✅ Expense extracted:\n\n';
    
    if (date) {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      const formatted =
        dateObj instanceof Date && !isNaN(dateObj.getTime())
          ? dateObj.toISOString().slice(0, 10)
          : String(date);
      message += `📅 Date: ${formatted}\n`;
    }
    
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

