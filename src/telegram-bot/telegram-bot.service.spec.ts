import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CoreApiService } from '../core-api/core-api.service';
import { TelegramBotService } from './telegram-bot.service';

describe('TelegramBotService.createCost', () => {
  it('names the user by the pending telegramId and sends no userId', async () => {
    const coreApi = { createCost: jest.fn().mockResolvedValue({}) };
    const service = new TelegramBotService(
      {} as HttpService,
      { get: jest.fn() } as unknown as ConfigService,
      coreApi as unknown as CoreApiService,
    );
    service.setPendingExpense(42, {
      amount: 250,
      currency: 'RUB',
      comment: 'Shop',
      date: '2026-10-09T00:00:00.000Z',
      telegramId: 42,
      categoryId: 'c1',
    });

    await service.createCost(42, 'f1');

    expect(coreApi.createCost).toHaveBeenCalledWith(42, {
      amount: 250,
      category: 'c1',
      comment: 'Shop',
      date: '2026-10-09T00:00:00.000Z',
      fundId: 'f1',
    });
    expect(service.getPendingExpense(42)).toBeUndefined();
  });
});
