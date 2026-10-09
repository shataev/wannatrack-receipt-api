import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Context } from 'telegraf';
import {
  CoreApiService,
  TelegramAccountNotLinkedError,
} from '../core-api/core-api.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramBotUpdate } from './telegram-bot.update';

const CHAT_ID = 1001;
const OWNER_ID = 1001;
const OTHER_ID = 2002;

type Mocked<T extends string> = Record<T, jest.Mock>;

describe('TelegramBotUpdate', () => {
  let coreApi: Mocked<
    | 'createCost'
    | 'getFunds'
    | 'getUserIdByTelegramId'
    | 'getCategories'
    | 'getMe'
    | 'setActiveTag'
    | 'getTags'
  >;
  let botService: TelegramBotService;
  let update: TelegramBotUpdate;

  beforeEach(() => {
    coreApi = {
      createCost: jest.fn().mockResolvedValue({}),
      getFunds: jest.fn().mockResolvedValue([]),
      getUserIdByTelegramId: jest.fn().mockResolvedValue('u1'),
      getCategories: jest
        .fn()
        .mockResolvedValue([{ name: 'Food', value: 'c1' }]),
      getMe: jest.fn().mockResolvedValue({ activeTag: null }),
      setActiveTag: jest.fn(),
      getTags: jest.fn().mockResolvedValue([]),
    };
    botService = new TelegramBotService(
      {} as HttpService,
      { get: jest.fn() } as unknown as ConfigService,
      coreApi as unknown as CoreApiService,
    );
    update = new TelegramBotUpdate(botService);
  });

  const setPending = () =>
    botService.setPendingExpense(CHAT_ID, {
      amount: 250,
      currency: 'RUB',
      date: '2026-10-09T00:00:00.000Z',
      telegramId: OWNER_ID,
      categoryId: 'c1',
    });

  const press = (fromId: number, data: string, inlineKeyboard?: unknown) => {
    const ctx = {
      from: { id: fromId },
      chat: { id: CHAT_ID, type: 'private' },
      callbackQuery: {
        data,
        message: {
          chat: { id: CHAT_ID },
          ...(inlineKeyboard !== undefined && {
            reply_markup: { inline_keyboard: inlineKeyboard },
          }),
        },
      },
      answerCbQuery: jest.fn().mockResolvedValue(true),
      editMessageReplyMarkup: jest.fn().mockResolvedValue(true),
      reply: jest.fn().mockResolvedValue({}),
    };
    return update.onCallbackQuery(ctx as unknown as Context).then(() => ctx);
  };

  const textCtx = (text: string, fromId = OWNER_ID) => ({
    from: { id: fromId },
    chat: { id: CHAT_ID, type: 'private' },
    message: { text },
    telegram: { sendChatAction: jest.fn().mockResolvedValue(true) },
    reply: jest.fn().mockResolvedValue({}),
  });

  const lastReply = (ctx: { reply: jest.Mock }) =>
    ctx.reply.mock.calls.at(-1) as [
      string,
      {
        reply_markup?: {
          inline_keyboard: { text: string; callback_data: string }[][];
        };
      }?,
    ];

  const buttonData = (extra?: {
    reply_markup?: {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
  }) =>
    extra?.reply_markup?.inline_keyboard.map((row) =>
      row.map((button) => button.callback_data),
    );

  /** Lets a handler run up to its first pending await. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  describe('button presses', () => {
    beforeEach(setPending);

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

    it('ignores "without #tag" pressed by another Telegram user', async () => {
      const ctx = await press(OTHER_ID, 'notag');

      expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled();
      expect(botService.getPendingExpense(CHAT_ID)?.untagged).toBeUndefined();
    });

    it('saves the expense when the owner presses the account button', async () => {
      await press(OWNER_ID, 'fund_f1');

      expect(coreApi.createCost).toHaveBeenCalledWith(
        OWNER_ID,
        expect.objectContaining({ category: 'c1', fundId: 'f1' }),
      );
      expect(botService.getPendingExpense(CHAT_ID)).toBeUndefined();
    });

    it('asks for the currency again when the API has no rate for it', async () => {
      botService.updatePendingExpense(CHAT_ID, { currency: 'KRW' });
      coreApi.getMe.mockResolvedValue({ defaultCurrency: 'USD' });
      coreApi.getFunds.mockResolvedValue([
        { _id: 'f1', name: 'Card', currency: 'THB', currentBalance: 5000 },
      ]);
      coreApi.createCost
        .mockRejectedValueOnce({
          response: {
            status: 400,
            data: { error: 'Exchange rate not found for currency: KRW' },
          },
        })
        .mockResolvedValueOnce({ amount: 250, currency: 'THB' });

      const rejected = await press(OWNER_ID, 'fund_f1');

      const [question, extra] = lastReply(rejected);
      expect(question).toContain('no exchange rate for KRW');
      expect(question).toContain('Which currency was it?');
      expect(buttonData(extra)).toEqual([['cur_THB', 'cur_USD']]);
      expect(botService.getPendingExpense(CHAT_ID)?.categoryId).toBe('c1');

      // Category is already chosen, so the choice leads back to the accounts.
      const chosen = await press(OWNER_ID, 'cur_THB');
      expect(buttonData(lastReply(chosen)[1])).toEqual([
        ['fund_f1'],
        ['fund_none'],
      ]);

      await press(OWNER_ID, 'fund_f1');
      expect(coreApi.createCost).toHaveBeenLastCalledWith(
        OWNER_ID,
        expect.objectContaining({
          category: 'c1',
          fundId: 'f1',
          currency: 'THB',
        }),
      );
      expect(botService.getPendingExpense(CHAT_ID)).toBeUndefined();
    });

    it('ignores a currency button pressed by another Telegram user', async () => {
      const ctx = await press(OTHER_ID, 'cur_JPY');

      expect(ctx.reply).not.toHaveBeenCalled();
      expect(botService.getPendingExpense(CHAT_ID)?.currency).toBe('RUB');
    });
  });

  describe('"Without #tag" racing other presses', () => {
    beforeEach(() => {
      botService.setPendingExpense(CHAT_ID, {
        amount: 1500,
        currency: 'JPY',
        date: '2026-10-25T00:00:00.000Z',
        telegramId: OWNER_ID,
        activeTag: 'japan-2026',
      });
    });

    it('sticks when pressed while the category press is still loading accounts', async () => {
      let releaseFunds!: (funds: unknown[]) => void;
      coreApi.getFunds.mockReturnValueOnce(
        new Promise((resolve) => (releaseFunds = resolve)),
      );

      const category = press(OWNER_ID, 'cat_c1');
      await flush();
      const notag = await press(OWNER_ID, 'notag');
      releaseFunds([
        { _id: 'f1', name: 'Card', currency: 'THB', currentBalance: 5000 },
      ]);
      await category;
      await press(OWNER_ID, 'fund_f1');

      expect(notag.answerCbQuery).toHaveBeenCalledWith(
        'This expense will be saved without #japan-2026',
      );
      expect(coreApi.createCost).toHaveBeenCalledWith(
        OWNER_ID,
        expect.objectContaining({ category: 'c1', fundId: 'f1', tags: [] }),
      );
    });

    it('says it is too late while the save is in flight, instead of promising', async () => {
      botService.updatePendingExpense(CHAT_ID, { categoryId: 'c1' });
      let finishSave!: (cost: unknown) => void;
      coreApi.createCost.mockReturnValueOnce(
        new Promise((resolve) => (finishSave = resolve)),
      );

      const save = press(OWNER_ID, 'fund_none');
      await flush();
      const notag = await press(OWNER_ID, 'notag');
      finishSave({ amount: 1500, currency: 'JPY', tags: ['japan-2026'] });
      await save;

      expect(notag.answerCbQuery).toHaveBeenCalledWith(
        'Too late: this expense is already being saved.',
      );
      expect(notag.editMessageReplyMarkup).not.toHaveBeenCalled();
    });
  });

  describe('receipt preview', () => {
    beforeEach(() => {
      jest.spyOn(botService, 'handleText').mockResolvedValue({
        total: 1500,
        currency: 'JPY',
        merchant: 'Ramen',
        date: '2026-10-25T00:00:00.000Z',
      } as never);
    });

    it('shows the active tag and offers to save without it', async () => {
      coreApi.getMe.mockResolvedValue({ activeTag: 'japan-2026' });
      const ctx = textCtx('ramen 1500 yen');

      await update.onText(ctx as unknown as Context);

      const [text, extra] = lastReply(ctx);
      expect(text).toContain('💰 Amount: 1500 JPY');
      expect(text).toContain('🏷 Trip: #japan-2026');
      expect(extra?.reply_markup?.inline_keyboard.at(-1)).toEqual([
        expect.objectContaining({
          text: 'Without #japan-2026',
          callback_data: 'notag',
        }),
      ]);
      expect(botService.getPendingExpense(CHAT_ID)).toEqual(
        expect.objectContaining({
          currency: 'JPY',
          activeTag: 'japan-2026',
        }),
      );
    });

    it('maps a currency symbol from the analysis to its code', async () => {
      jest
        .spyOn(botService, 'handleText')
        .mockResolvedValue({ total: 1500, currency: '¥' } as never);
      const ctx = textCtx('ramen ¥1500');

      await update.onText(ctx as unknown as Context);

      expect(lastReply(ctx)[0]).toContain('💰 Amount: 1500 JPY');
      expect(botService.getPendingExpense(CHAT_ID)?.currency).toBe('JPY');
    });

    describe('when the currency is not recognised', () => {
      beforeEach(() => {
        jest.spyOn(botService, 'handleText').mockResolvedValue({
          total: 1500,
          currency: 'UNKNOWN',
          merchant: 'Ramen',
          date: '2026-10-25T00:00:00.000Z',
        } as never);
        coreApi.getFunds.mockResolvedValue(
          [
            ['f1', 'THB'],
            ['f2', 'THB'],
            ['f3', 'JPY'],
          ].map(([_id, currency]) => ({
            _id,
            name: _id,
            currency,
            currentBalance: 5000,
          })),
        );
      });

      it('asks which currency before the category, from accounts plus the default', async () => {
        coreApi.getMe.mockResolvedValue({
          activeTag: 'japan-2026',
          defaultCurrency: 'USD',
        });
        const ctx = textCtx('ramen 1500');

        await update.onText(ctx as unknown as Context);

        const [text, extra] = lastReply(ctx);
        expect(text).toContain('(currency not recognised)');
        expect(text).toContain('Which currency was it?');
        expect(text).not.toContain('Choose a category');
        expect(buttonData(extra)).toEqual([['cur_THB', 'cur_JPY', 'cur_USD']]);
        expect(ctx.reply).toHaveBeenCalledTimes(1);
      });

      it('uses the chosen currency all the way to the save', async () => {
        coreApi.getMe.mockResolvedValue({
          activeTag: 'japan-2026',
          defaultCurrency: 'USD',
        });
        await update.onText(textCtx('ramen 1500') as unknown as Context);

        const chosen = await press(OWNER_ID, 'cur_JPY');
        const [text, extra] = lastReply(chosen);
        expect(text).toContain('💰 Amount: 1500 JPY');
        expect(text).toContain('🏷 Trip: #japan-2026');
        expect(buttonData(extra)).toEqual([['cat_c1'], ['notag']]);

        await press(OWNER_ID, 'cat_c1');
        await press(OWNER_ID, 'fund_f1');
        expect(coreApi.createCost).toHaveBeenCalledWith(
          OWNER_ID,
          expect.objectContaining({ currency: 'JPY', fundId: 'f1' }),
        );
      });

      it('falls back to USD as the default, as the API does', async () => {
        coreApi.getMe.mockResolvedValue({ activeTag: null });
        coreApi.getFunds.mockResolvedValue([]);
        const ctx = textCtx('ramen 1500');

        await update.onText(ctx as unknown as Context);

        expect(buttonData(lastReply(ctx)[1])).toEqual([['cur_USD']]);
      });

      it('offers the account currencies when the user cannot be read', async () => {
        coreApi.getMe.mockRejectedValue(new Error('timeout'));
        const ctx = textCtx('ramen 1500');

        await update.onText(ctx as unknown as Context);

        expect(buttonData(lastReply(ctx)[1])).toEqual([['cur_THB', 'cur_JPY']]);
      });

      it('never saves in the account currency when there is nothing to offer', async () => {
        coreApi.getMe.mockRejectedValue(new Error('timeout'));
        coreApi.getFunds.mockResolvedValue([]);
        const ctx = textCtx('ramen 1500');

        await update.onText(ctx as unknown as Context);

        expect(lastReply(ctx)[0]).toContain('Please send the expense again');
        expect(botService.getPendingExpense(CHAT_ID)).toBeUndefined();
        expect(coreApi.createCost).not.toHaveBeenCalled();
      });
    });

    it('still offers to save when the active tag cannot be read', async () => {
      coreApi.getMe.mockRejectedValue(new Error('timeout'));
      const ctx = textCtx('ramen 1500 yen');

      await update.onText(ctx as unknown as Context);

      const [text, extra] = lastReply(ctx);
      expect(text).not.toContain('🏷');
      expect(text).toContain('Choose a category to save:');
      expect(extra?.reply_markup?.inline_keyboard).toHaveLength(1);
    });

    it('goes from preview to a saved expense without the active tag', async () => {
      coreApi.getMe.mockResolvedValue({ activeTag: 'japan-2026' });
      coreApi.getFunds.mockResolvedValue([
        { _id: 'f1', name: 'Card', currency: 'THB', currentBalance: 5000 },
      ]);
      coreApi.createCost.mockResolvedValue({
        amount: 1500,
        currency: 'JPY',
        fundAmount: 352.4,
        tags: [],
      });
      const ctx = textCtx('ramen 1500 yen');
      await update.onText(ctx as unknown as Context);
      const keyboard = lastReply(ctx)[1]!.reply_markup!.inline_keyboard;

      const notag = await press(OWNER_ID, 'notag', keyboard);
      expect(notag.editMessageReplyMarkup).toHaveBeenCalledWith({
        inline_keyboard: [
          [expect.objectContaining({ callback_data: 'cat_c1' })],
        ],
      });
      expect(notag.answerCbQuery).toHaveBeenCalledWith(
        'This expense will be saved without #japan-2026',
      );

      await press(OWNER_ID, 'cat_c1');
      const saved = await press(OWNER_ID, 'fund_f1');

      expect(coreApi.createCost).toHaveBeenCalledWith(OWNER_ID, {
        amount: 1500,
        category: 'c1',
        comment: 'Ramen',
        date: '2026-10-25T00:00:00.000Z',
        fundId: 'f1',
        currency: 'JPY',
        tags: [],
      });
      expect(lastReply(saved)[0]).toBe(
        '✅ Saved: 1500 JPY → 352.40 THB from Card',
      );
    });
  });

  describe('/trip', () => {
    const trip = async (text: string) => {
      const ctx = textCtx(text);
      await update.onTrip(ctx as unknown as Context);
      return ctx;
    };

    it('sets the active tag from the rest of the command', async () => {
      coreApi.setActiveTag.mockResolvedValue({ activeTag: 'japan-2026' });

      const ctx = await trip('/trip Japan 2026');

      expect(coreApi.setActiveTag).toHaveBeenCalledWith(OWNER_ID, 'Japan 2026');
      expect(lastReply(ctx)[0]).toContain('#japan-2026');
    });

    it('clears it with "off", also when addressed to the bot by name', async () => {
      coreApi.setActiveTag.mockResolvedValue({ activeTag: null });

      await trip('/trip off');
      const ctx = await trip('/trip@WannaTrackBot OFF');

      expect(coreApi.setActiveTag).toHaveBeenNthCalledWith(1, OWNER_ID, null);
      expect(coreApi.setActiveTag).toHaveBeenNthCalledWith(2, OWNER_ID, null);
      expect(lastReply(ctx)[0]).toContain('Trip turned off');
    });

    it('warns when the name normalises to nothing', async () => {
      coreApi.setActiveTag.mockResolvedValue({ activeTag: null });

      const ctx = await trip('/trip !!!');

      expect(lastReply(ctx)[0]).toContain('not a usable tag name');
    });

    it('alone, shows the current tag and recent ones as buttons', async () => {
      coreApi.getMe.mockResolvedValue({ activeTag: 'japan-2026' });
      coreApi.getTags.mockResolvedValue(
        [
          'japan-2026',
          'бали',
          'ж'.repeat(32), // 69 bytes of callback data: Telegram would reject the keyboard
          'thailand',
          'a',
          'b',
          'c',
          'd',
        ].map((tag) => ({ tag })),
      );

      const ctx = await trip('/trip');

      const [text, extra] = lastReply(ctx);
      expect(text).toContain('Active trip: #japan-2026');
      const buttons = extra!.reply_markup!.inline_keyboard.map(
        ([button]) => button.callback_data,
      );
      expect(buttons).toEqual([
        'trip:бали',
        'trip:thailand',
        'trip:a',
        'trip:b',
        'trip:c',
        'trip_off',
      ]);
      expect(coreApi.setActiveTag).not.toHaveBeenCalled();
    });

    it('alone, without an active tag or history, sends no keyboard', async () => {
      const ctx = await trip('/trip');

      expect(lastReply(ctx)).toEqual([
        expect.stringContaining('No active trip'),
        undefined,
      ]);
    });

    it('switches when a tag button is pressed', async () => {
      coreApi.setActiveTag.mockResolvedValue({ activeTag: 'бали' });

      const ctx = await press(OWNER_ID, 'trip:бали');

      expect(coreApi.setActiveTag).toHaveBeenCalledWith(OWNER_ID, 'бали');
      expect(lastReply(ctx)[0]).toContain('#бали');
      expect(ctx.answerCbQuery).toHaveBeenCalledTimes(1);
    });

    it('turns off from the button', async () => {
      coreApi.setActiveTag.mockResolvedValue({ activeTag: null });

      await press(OWNER_ID, 'trip_off');

      expect(coreApi.setActiveTag).toHaveBeenCalledWith(OWNER_ID, null);
    });

    it('asks to link the account when the Telegram id is unknown', async () => {
      coreApi.setActiveTag.mockRejectedValue(
        new TelegramAccountNotLinkedError(OWNER_ID),
      );

      const ctx = await trip('/trip japan');

      expect(lastReply(ctx)[0]).toContain('not linked');
    });
  });
});
