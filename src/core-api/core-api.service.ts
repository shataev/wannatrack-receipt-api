import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface CoreCategory {
  name: string;
  icon?: string;
  value: string; // _id
}

export interface CoreFund {
  _id: string;
  name: string;
  icon: string | null;
  userId: string;
  description: string;
  initialBalance: number;
  currentBalance: number;
  isDefault: boolean;
  currency: string;
  createdAt: string;
  updatedAt: string;
  __v?: number;
}

export interface GetFundsResponse {
  funds: CoreFund[];
  total: {
    amount: number;
    currency: string;
    fundsCount: number;
  };
}

export interface CreateCostPayload {
  amount: number;
  category: string;
  comment?: string;
  date: string; // ISO
  fundId?: string;
  /** ISO code of what was spent; absent → the API books in the fund's (or the user's) currency */
  currency?: string;
  /** Absent → the API applies the user's active tag; `[]` saves the expense untagged */
  tags?: string[];
}

/** The fields of the saved cost (POST /api/cost) the bot reports back. */
export interface CreatedCost {
  amount: number;
  currency: string;
  /** Debited from the fund, in the fund's currency; missing means `amount` */
  fundAmount?: number;
  tags?: string[];
}

/** The fields of the full user (GET /api/me) the bot reads. */
export interface CoreUser {
  activeTag?: string | null;
  /** Unset on old accounts; the API then books in USD */
  defaultCurrency?: string;
}

export interface CoreTag {
  tag: string;
  count: number;
  total: number;
  currency: string;
  firstDate: string;
  lastDate: string;
}

/**
 * The core API answered 401 to a call made on behalf of a Telegram user:
 * that Telegram id is not linked to any account (any more).
 */
export class TelegramAccountNotLinkedError extends Error {
  constructor(readonly telegramId: number) {
    super(`Telegram account ${telegramId} is not linked`);
    this.name = 'TelegramAccountNotLinkedError';
  }
}

@Injectable()
export class CoreApiService {
  private readonly logger = new Logger(CoreApiService.name);
  private readonly apiBaseUrl: string;
  private readonly botSecret: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.apiBaseUrl =
      this.configService.get<string>('API_BASE_URL') || 'http://localhost:8900';
    this.botSecret =
      this.configService.get<string>('TELEGRAM_BOT_SECRET') || '';
  }

  /** The core API resolves the user from the bot secret plus the Telegram id. */
  private getHeaders(telegramId: number) {
    return {
      'Content-Type': 'application/json',
      ...(this.botSecret && { 'X-Telegram-Bot-Secret': this.botSecret }),
      'X-Telegram-User-Id': String(telegramId),
    };
  }

  private rethrowIfNotLinked(error: unknown, telegramId: number): void {
    const status = (error as { response?: { status?: number } } | undefined)
      ?.response?.status;
    if (status === 401) {
      throw new TelegramAccountNotLinkedError(telegramId);
    }
  }

  /**
   * Get user id by Telegram id. Core API must expose e.g. GET /api/users/by-telegram/:telegramId
   * returning { userId: string } or { id: string }.
   */
  async getUserIdByTelegramId(telegramId: number): Promise<string | null> {
    try {
      const response$ = this.httpService.get<{ userId?: string; id?: string }>(
        `${this.apiBaseUrl}/api/telegram/user-by-telegram/${telegramId}`,
        { headers: this.getHeaders(telegramId) },
      );
      const { data } = await firstValueFrom(response$);
      return data.userId ?? data.id ?? null;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.logger.warn(
        `getUserIdByTelegramId(${telegramId}): ${error.message}`,
      );
      return null;
    }
  }

  async getCategories(telegramId: number): Promise<CoreCategory[]> {
    try {
      const response$ = this.httpService.get<CoreCategory[]>(
        `${this.apiBaseUrl}/api/category`,
        { headers: this.getHeaders(telegramId) },
      );
      const { data } = await firstValueFrom(response$);
      return Array.isArray(data) ? data : [];
    } catch (error: any) {
      this.rethrowIfNotLinked(error, telegramId);
      throw error;
    }
  }

  /**
   * Get the funds of the user linked to this Telegram id (GET /api/funds).
   */
  async getFunds(telegramId: number): Promise<CoreFund[]> {
    try {
      const response$ = this.httpService.get<GetFundsResponse>(
        `${this.apiBaseUrl}/api/funds`,
        { headers: this.getHeaders(telegramId) },
      );

      const { data } = await firstValueFrom(response$);

      return Array.isArray(data?.funds) ? data.funds : [];
    } catch (error: any) {
      this.rethrowIfNotLinked(error, telegramId);
      if (error.response?.status === 404) {
        return [];
      }
      this.logger.warn(`getFunds(${telegramId}): ${error.message}`);
      return [];
    }
  }

  async createCost(
    telegramId: number,
    payload: CreateCostPayload,
  ): Promise<CreatedCost> {
    try {
      const response$ = this.httpService.post<CreatedCost>(
        `${this.apiBaseUrl}/api/cost`,
        payload,
        { headers: this.getHeaders(telegramId) },
      );
      const { data } = await firstValueFrom(response$);
      return data;
    } catch (error: any) {
      this.rethrowIfNotLinked(error, telegramId);
      throw error;
    }
  }

  /** The full user, for the active tag (GET /api/me). */
  async getMe(telegramId: number): Promise<CoreUser> {
    try {
      const response$ = this.httpService.get<CoreUser>(
        `${this.apiBaseUrl}/api/me`,
        { headers: this.getHeaders(telegramId) },
      );
      const { data } = await firstValueFrom(response$);
      return data;
    } catch (error: any) {
      this.rethrowIfNotLinked(error, telegramId);
      throw error;
    }
  }

  /**
   * Set (or with `null` clear) the active tag. The API normalises it and
   * answers with the full user; a tag that normalises to nothing clears it.
   */
  async setActiveTag(
    telegramId: number,
    tag: string | null,
  ): Promise<CoreUser> {
    try {
      const response$ = this.httpService.put<CoreUser>(
        `${this.apiBaseUrl}/api/me/active-tag`,
        { tag },
        { headers: this.getHeaders(telegramId) },
      );
      const { data } = await firstValueFrom(response$);
      return data;
    } catch (error: any) {
      this.rethrowIfNotLinked(error, telegramId);
      throw error;
    }
  }

  /** The user's tags, most recently used first (GET /api/tags). */
  async getTags(telegramId: number): Promise<CoreTag[]> {
    try {
      const response$ = this.httpService.get<CoreTag[]>(
        `${this.apiBaseUrl}/api/tags`,
        { headers: this.getHeaders(telegramId) },
      );
      const { data } = await firstValueFrom(response$);
      return Array.isArray(data) ? data : [];
    } catch (error: any) {
      this.rethrowIfNotLinked(error, telegramId);
      throw error;
    }
  }
}
