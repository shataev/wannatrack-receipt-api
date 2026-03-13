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
  userId: string;
  date: string; // ISO
  fundId?: string;
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

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      ...(this.botSecret && { 'X-Telegram-Bot-Secret': this.botSecret }),
    };
  }

  /**
   * Get user id by Telegram id. Core API must expose e.g. GET /api/users/by-telegram/:telegramId
   * returning { userId: string } or { id: string }.
   */
  async getUserIdByTelegramId(telegramId: number): Promise<string | null> {
    try {
      const response$ = this.httpService.get<{ userId?: string; id?: string }>(
        `${this.apiBaseUrl}/api/telegram/user-by-telegram/${telegramId}`,
        { headers: this.getHeaders() },
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

  async getCategories(userId: string): Promise<CoreCategory[]> {
    const response$ = this.httpService.get<CoreCategory[]>(
      `${this.apiBaseUrl}/api/category`,
      {
        params: { userId },
        headers: this.getHeaders(),
      },
    );
    const { data } = await firstValueFrom(response$);
    return Array.isArray(data) ? data : [];
  }

  /**
   * Get user's funds. Core API must expose e.g. GET /api/funds?userId=...
   */
  async getFunds(userId: string): Promise<CoreFund[]> {
    try {
      const response$ = this.httpService.get<GetFundsResponse>(
        `${this.apiBaseUrl}/api/funds`,
        {
          params: { userId },
          headers: this.getHeaders(),
        },
      );

      const { data } = await firstValueFrom(response$);

      return Array.isArray(data?.funds) ? data.funds : [];
    } catch (error: any) {
      if (error.response?.status === 404) {
        return [];
      }
      this.logger.warn(`getFunds(${userId}): ${error.message}`);
      return [];
    }
  }

  async createCost(payload: CreateCostPayload): Promise<unknown> {
    const response$ = this.httpService.post(
      `${this.apiBaseUrl}/api/cost`,
      payload,
      { headers: this.getHeaders() },
    );
    const { data } = await firstValueFrom(response$);
    return data;
  }
}
