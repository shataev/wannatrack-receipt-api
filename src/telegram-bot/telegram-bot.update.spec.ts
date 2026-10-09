import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Context } from 'telegraf';
import { CoreApiService } from '../core-api/core-api.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramBotUpdate } from './telegram-bot.update';

const CHAT_ID = 1001;
const OWNER_ID = 1001;
const OTHER_ID = 2002;

describe('TelegramBotUpdate button presses', () => {
  let coreApi: { createCost: jest.Mock; getFunds: jest.Mock };
  let botService: TelegramBotService;
  let update: TelegramBotUpdate;

  beforeEach(() => {
    coreApi = {
      createCost: jest.fn().mockResolvedValue({}),
      getFunds: jest.fn().mockResolvedValue([]),
    };
    botService = new TelegramBotService(
      {} as HttpService,
      { get: jest.fn() } as unknown as ConfigService,
      coreApi as unknown as CoreApiService,
    );
    update = new TelegramBotUpdate(botService);
    botService.setPendingExpense(CHAT_ID, {
      amount: 250,
      currency: 'RUB',
      date: '2026-10-09T00:00:00.000Z',
      telegramId: OWNER_ID,
      categoryId: 'c1',
    });
  });

  const press = (fromId: number, data: string) => {
    const ctx = {
      from: { id: fromId },
      chat: { id: CHAT_ID, type: 'private' },
      callbackQuery: { data, message: { chat: { id: CHAT_ID } } },
      answerCbQuery: jest.fn().mockResolvedValue(true),
      reply: jest.fn().mockResolvedValue({}),
    };
    return update.onCallbackQuery(ctx as unknown as Context).then(() => ctx);
  };

  it('ignores an account button pressed by another Telegram user', async () => {
    const ctx = await press(OTHER_ID, 'fund_f1');

    expect(coreApi.createCost).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(botService.getPendingExpense(CHAT_ID)?.telegramId).toBe(OWNER_ID);
  });

  it('ignores a category button pressed by another Telegram user', async () => {
    const ctx = await press(OTHER_ID, 'cat_c2');

    expect(coreApi.getFunds).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(botService.getPendingExpense(CHAT_ID)?.categoryId).toBe('c1');
  });

  it('saves the expense when the owner presses the account button', async () => {
    await press(OWNER_ID, 'fund_f1');

    expect(coreApi.createCost).toHaveBeenCalledWith(
      OWNER_ID,
      expect.objectContaining({ category: 'c1', fundId: 'f1' }),
    );
    expect(botService.getPendingExpense(CHAT_ID)).toBeUndefined();
  });
});
