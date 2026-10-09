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
  CoreTag,
  CoreUser,
  CreatedCost,
  CreateCostPayload,
} from '../core-api/core-api.service';
import { ReceiptResultDto } from '../receipts/dto/receipt-result.dto';

export interface PendingExpense {
  amount: number;
  /** ISO code from the analysis; absent → booked in the account's currency */
  currency?: string;
  comment?: string;
  date: string;
  telegramId: number;
  categoryId?: string;
  /** Active tag shown in the preview, if any */
  activeTag?: string | null;
  /** "without #tag" was pressed: save this one expense with `tags: []` */
  untagged?: boolean;
  /** The accounts offered on the keyboard, to name the chosen one afterwards */
  funds?: CoreFund[];
  /** Offered again after the currency question */
  categories?: CoreCategory[];
  /** The save request is in flight: later changes cannot reach it */
  saving?: boolean;
}

/**
 * Symbols and words the analyzer may return instead of an ISO code. Keys are
 * lowercase; lookup is case-insensitive.
 */
const CURRENCY_ALIASES: Record<string, string> = {
  '¥': 'JPY',
  円: 'JPY',
  yen: 'JPY',
  '฿': 'THB',
  baht: 'THB',
  '₫': 'VND',
  dong: 'VND',
  $: 'USD',
  '€': 'EUR',
  '₽': 'RUB',
};

/**
 * The analyzer's currency as an ISO 4217 code, or undefined when it gave
 * none (`UNKNOWN`, empty) or something that is not a code.
 */
export function toCurrencyCode(
  currency: string | null | undefined,
): string | undefined {
  const raw = currency?.trim().toLowerCase();
  if (!raw) return undefined;
  const alias = CURRENCY_ALIASES[raw];
  if (alias) return alias;
  return /^[a-z]{3}$/.test(raw) ? raw.toUpperCase() : undefined;
}

/** An amount with the decimals its currency uses (JPY 1500, THB 352.40). */
export function formatMoney(value: number, currency: string): string {
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // not a currency Intl knows: keep two decimals
  }
  return `${value.toFixed(digits)} ${currency}`;
}

export const WITHOUT_TAG_CALLBACK = 'notag';
export const CURRENCY_CALLBACK_PREFIX = 'cur_';

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

  /**
   * Merges `patch` into the pending expense as it is now, not as it was
   * before an await, so a choice made meanwhile (e.g. "Without #tag") is kept.
   */
  updatePendingExpense(
    chatId: number,
    patch: Partial<PendingExpense>,
  ): PendingExpense | undefined {
    const current = this.pendingByChat.get(chatId);
    if (!current) return undefined;
    const updated = { ...current, ...patch };
    this.pendingByChat.set(chatId, updated);
    return updated;
  }

  clearPendingExpense(chatId: number): void {
    this.pendingByChat.delete(chatId);
  }

  getUserIdByTelegramId(telegramId: number): Promise<string | null> {
    return this.coreApi.getUserIdByTelegramId(telegramId);
  }

  getCategories(telegramId: number): Promise<CoreCategory[]> {
    return this.coreApi.getCategories(telegramId);
  }

  getFunds(telegramId: number): Promise<CoreFund[]> {
    return this.coreApi.getFunds(telegramId);
  }

  getMe(telegramId: number): Promise<CoreUser> {
    return this.coreApi.getMe(telegramId);
  }

  setActiveTag(telegramId: number, tag: string | null): Promise<CoreUser> {
    return this.coreApi.setActiveTag(telegramId, tag);
  }

  getTags(telegramId: number): Promise<CoreTag[]> {
    return this.coreApi.getTags(telegramId);
  }

  /** With an active tag, a last row offers to save this expense without it. */
  buildCategoryKeyboard(
    categories: CoreCategory[],
    activeTag?: string | null,
  ): InlineKeyboardMarkup {
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
    if (activeTag) {
      rows.push([
        Markup.button.callback(`Without #${activeTag}`, WITHOUT_TAG_CALLBACK),
      ]);
    }
    return Markup.inlineKeyboard(rows).reply_markup;
  }

  /** The currencies of the user's accounts plus their default, each once. */
  currencyChoices(funds: CoreFund[], defaultCurrency?: string): string[] {
    const codes = [...funds.map((fund) => fund.currency), defaultCurrency]
      .map((code) => toCurrencyCode(code))
      .filter((code): code is string => code !== undefined);
    return [...new Set(codes)];
  }

  buildCurrencyKeyboard(currencies: string[]): InlineKeyboardMarkup {
    const rows: Array<ReturnType<typeof Markup.button.callback>[]> = [];
    for (let i = 0; i < currencies.length; i += 3) {
      rows.push(
        currencies
          .slice(i, i + 3)
          .map((code) =>
            Markup.button.callback(code, CURRENCY_CALLBACK_PREFIX + code),
          ),
      );
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

  /** Saves the pending expense and returns the reply describing what was booked. */
  async createCost(chatId: number, fundId: string | null): Promise<string> {
    const pending = this.getPendingExpense(chatId);
    if (!pending) throw new Error('No pending expense');

    const payload: CreateCostPayload = {
      amount: pending.amount,
      category: pending.categoryId!,
      comment: pending.comment,
      date: pending.date,
    };
    
    if (fundId) {
      payload.fundId = fundId;
    } 
    if (pending.currency) {
      payload.currency = pending.currency;
    }
    if (pending.untagged) {
      payload.tags = [];
    }

    this.updatePendingExpense(chatId, { saving: true });
    let cost: CreatedCost;
    try {
      cost = await this.coreApi.createCost(pending.telegramId, payload);
    } catch (error) {
      this.updatePendingExpense(chatId, { saving: false });
      throw error;
    }
    this.clearPendingExpense(chatId);

    const fund = fundId
      ? pending.funds?.find((f) => f._id === fundId)
      : undefined;
    return this.formatSavedCost(cost, fund);
  }

  /** `✅ Saved: 1500 JPY → 352.40 THB from Card · #japan-2026` */
  formatSavedCost(cost: CreatedCost | undefined, fund?: CoreFund): string {
    // The expense is already booked here: never fail, or the user would retry
    // and book it twice.
    if (typeof cost?.amount !== 'number' || !cost.currency) {
      return '✅ Expense saved.';
    }
    let message = `✅ Saved: ${formatMoney(cost.amount, cost.currency)}`;
    if (fund) {
      if (fund.currency && fund.currency !== cost.currency) {
        const debited =
          typeof cost.fundAmount === 'number' ? cost.fundAmount : cost.amount;
        message += ` → ${formatMoney(debited, fund.currency)}`;
      }
      message += ` from ${fund.name}`;
    }
    const tags = Array.isArray(cost.tags) ? cost.tags : [];
    if (tags.length > 0) {
      message += ' · ' + tags.map((tag) => `#${tag}`).join(' ');
    }
    return message;
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

    const { total, merchant, confidence, date } = result;
    const currency = toCurrencyCode(result.currency);

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
      message += currency
        ? `💰 Amount: ${total} ${currency}\n`
        : `💰 Amount: ${total} (currency not recognised)\n`;
    }
    
    if (confidence !== undefined) {
      message += `📊 Confidence: ${(confidence * 100).toFixed(1)}%\n`;
    }

    return message;
  }
}

