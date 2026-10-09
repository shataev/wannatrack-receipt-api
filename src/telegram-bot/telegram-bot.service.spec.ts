import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import {
  CoreApiService,
  CoreFund,
  CreateCostPayload,
} from '../core-api/core-api.service';
import { ReceiptResultDto } from '../receipts/dto/receipt-result.dto';
import {
  PendingExpense,
  TelegramBotService,
  WITHOUT_TAG_CALLBACK,
  toCurrencyCode,
} from './telegram-bot.service';

const fund = (overrides: Partial<CoreFund> = {}): CoreFund =>
  ({
    _id: 'f1',
    name: 'Card',
    currency: 'THB',
    currentBalance: 10000,
    ...overrides,
  }) as CoreFund;

describe('TelegramBotService', () => {
  let coreApi: { createCost: jest.Mock };
  let service: TelegramBotService;

  beforeEach(() => {
    coreApi = { createCost: jest.fn().mockResolvedValue({}) };
    service = new TelegramBotService(
      {} as HttpService,
      { get: jest.fn() } as unknown as ConfigService,
      coreApi as unknown as CoreApiService,
    );
  });

  const pending = (
    overrides: Partial<PendingExpense> = {},
  ): PendingExpense => ({
    amount: 1500,
    currency: 'JPY',
    comment: 'Ramen',
    date: '2026-10-09T00:00:00.000Z',
    telegramId: 42,
    categoryId: 'c1',
    ...overrides,
  });

  describe('createCost', () => {
    it('names the user by the pending telegramId and sends the currency, no userId', async () => {
      service.setPendingExpense(42, pending());

      await service.createCost(42, 'f1');

      expect(coreApi.createCost).toHaveBeenCalledWith(42, {
        amount: 1500,
        category: 'c1',
        comment: 'Ramen',
        date: '2026-10-09T00:00:00.000Z',
        fundId: 'f1',
        currency: 'JPY',
      });
      expect(service.getPendingExpense(42)).toBeUndefined();
    });

    it('sends no currency when the analysis had none', async () => {
      service.setPendingExpense(42, pending({ currency: undefined }));

      await service.createCost(42, null);

      const [, payload] = coreApi.createCost.mock.calls[0] as [
        number,
        CreateCostPayload,
      ];
      expect(payload).not.toHaveProperty('currency');
      expect(payload).not.toHaveProperty('fundId');
    });

    it('leaves tags out so the API applies the active tag', async () => {
      service.setPendingExpense(42, pending({ activeTag: 'japan-2026' }));

      await service.createCost(42, null);

      const [, payload] = coreApi.createCost.mock.calls[0] as [
        number,
        CreateCostPayload,
      ];
      expect(payload).not.toHaveProperty('tags');
    });

    it('sends tags: [] after "without #tag" was pressed', async () => {
      service.setPendingExpense(
        42,
        pending({ activeTag: 'japan-2026', untagged: true }),
      );

      await service.createCost(42, null);

      const [, payload] = coreApi.createCost.mock.calls[0] as [
        number,
        CreateCostPayload,
      ];
      expect(payload.tags).toEqual([]);
    });

    it('describes the booking with the chosen account from the keyboard', async () => {
      coreApi.createCost.mockResolvedValue({
        amount: 1500,
        currency: 'JPY',
        fundAmount: 352.4,
        tags: ['japan-2026'],
      });
      service.setPendingExpense(
        42,
        pending({ funds: [fund({ _id: 'f0', name: 'Cash' }), fund()] }),
      );

      await expect(service.createCost(42, 'f1')).resolves.toBe(
        '✅ Saved: 1500 JPY → 352.40 THB from Card · #japan-2026',
      );
    });
  });

  describe('updatePendingExpense', () => {
    it('merges into the expense as it is now', () => {
      service.setPendingExpense(42, pending());
      const stale = service.getPendingExpense(42)!;
      service.updatePendingExpense(42, { untagged: true });

      service.updatePendingExpense(42, { categoryId: 'c2', funds: [] });

      expect(service.getPendingExpense(42)).toEqual({
        ...stale,
        untagged: true,
        categoryId: 'c2',
        funds: [],
      });
    });

    it('does nothing without a pending expense', () => {
      expect(service.updatePendingExpense(42, { untagged: true })).toBe(
        undefined,
      );
      expect(service.getPendingExpense(42)).toBeUndefined();
    });
  });

  describe('createCost while in flight', () => {
    it('marks the expense as saving, and clears the mark when the save fails', async () => {
      let seenWhileSaving: boolean | undefined;
      coreApi.createCost.mockImplementation(() => {
        seenWhileSaving = service.getPendingExpense(42)?.saving;
        return Promise.reject(new Error('Insufficient funds'));
      });
      service.setPendingExpense(42, pending());

      await expect(service.createCost(42, 'f1')).rejects.toThrow();

      expect(seenWhileSaving).toBe(true);
      expect(service.getPendingExpense(42)?.saving).toBe(false);
    });
  });

  describe('currencyChoices', () => {
    const funds = ['THB', 'THB', 'usd', 'JPY'].map((currency) =>
      fund({ currency }),
    );

    it('lists each account currency once, then the default currency', () => {
      expect(service.currencyChoices(funds, 'EUR')).toEqual([
        'THB',
        'USD',
        'JPY',
        'EUR',
      ]);
    });

    it('does not repeat the default when an account already has it', () => {
      expect(service.currencyChoices(funds, 'USD')).toEqual([
        'THB',
        'USD',
        'JPY',
      ]);
    });

    it('works without accounts or without a default', () => {
      expect(service.currencyChoices([], 'USD')).toEqual(['USD']);
      expect(service.currencyChoices(funds)).toEqual(['THB', 'USD', 'JPY']);
    });

    it('builds one button per currency, three to a row', () => {
      const keyboard = service.buildCurrencyKeyboard([
        'THB',
        'USD',
        'JPY',
        'EUR',
      ]);
      expect(
        keyboard.inline_keyboard.map((row) =>
          row.map((b) => ('callback_data' in b ? b.callback_data : '')),
        ),
      ).toEqual([['cur_THB', 'cur_USD', 'cur_JPY'], ['cur_EUR']]);
    });
  });

  describe('formatSavedCost', () => {
    it('shows no conversion when the account has the spent currency', () => {
      expect(
        service.formatSavedCost(
          { amount: 120.5, currency: 'THB', fundAmount: 120.5, tags: [] },
          fund(),
        ),
      ).toBe('✅ Saved: 120.50 THB from Card');
    });

    it('shows the amount alone without an account, with every tag', () => {
      expect(
        service.formatSavedCost({
          amount: 50000,
          currency: 'VND',
          tags: ['vietnam', 'food_trip'],
        }),
      ).toBe('✅ Saved: 50000 VND · #vietnam #food_trip');
    });

    it('treats a missing fundAmount as the amount', () => {
      expect(
        service.formatSavedCost({ amount: 100, currency: 'USD' }, fund()),
      ).toBe('✅ Saved: 100.00 USD → 100.00 THB from Card');
    });

    it('never throws on an unexpected response, since the cost is already saved', () => {
      expect(service.formatSavedCost(undefined, fund())).toBe(
        '✅ Expense saved.',
      );
      expect(service.formatSavedCost({} as never)).toBe('✅ Expense saved.');
    });
  });

  describe('formatExpenseResult', () => {
    const receipt = (currency: string | null): ReceiptResultDto =>
      ({ total: 1500, currency, merchant: 'Ramen' }) as ReceiptResultDto;

    it('says the currency was not recognised instead of inventing RUB', () => {
      const text = service.formatExpenseResult(receipt('UNKNOWN'));
      expect(text).toContain('💰 Amount: 1500 (currency not recognised)');
      expect(text).not.toContain('RUB');
    });

    it('shows a symbol from the analysis as its ISO code', () => {
      expect(service.formatExpenseResult(receipt('¥'))).toContain(
        '💰 Amount: 1500 JPY',
      );
    });

    it('shows the analysed currency as an ISO code', () => {
      expect(service.formatExpenseResult(receipt(' jpy '))).toContain(
        '💰 Amount: 1500 JPY',
      );
    });
  });

  describe('buildCategoryKeyboard', () => {
    const categories = [{ name: 'Food', value: 'c1' }];

    it('adds a "Without #tag" row when a tag is active', () => {
      const keyboard = service.buildCategoryKeyboard(categories, 'japan-2026');
      expect(keyboard.inline_keyboard.at(-1)).toEqual([
        expect.objectContaining({
          text: 'Without #japan-2026',
          callback_data: WITHOUT_TAG_CALLBACK,
        }),
      ]);
    });

    it('has no such row without an active tag', () => {
      const keyboard = service.buildCategoryKeyboard(categories, null);
      expect(keyboard.inline_keyboard).toHaveLength(1);
    });
  });
});

describe('toCurrencyCode', () => {
  it.each([
    ['¥', 'JPY'],
    ['円', 'JPY'],
    ['yen', 'JPY'],
    ['Yen', 'JPY'],
    ['JPY', 'JPY'],
    ['jpy', 'JPY'],
    ['฿', 'THB'],
    ['baht', 'THB'],
    ['BAHT', 'THB'],
    ['₫', 'VND'],
    ['dong', 'VND'],
    ['$', 'USD'],
    ['usd', 'USD'],
    ['€', 'EUR'],
    ['eur', 'EUR'],
    ['₽', 'RUB'],
    ['rub', 'RUB'],
    [' ¥ ', 'JPY'],
    [' thb ', 'THB'],
    ['krw', 'KRW'],
    ['UNKNOWN', undefined],
    ['', undefined],
    ['  ', undefined],
    [null, undefined],
    [undefined, undefined],
    ['JPY¥', undefined],
    ['US$', undefined],
  ])('%p → %p', (input, expected) => {
    expect(toCurrencyCode(input)).toBe(expected);
  });
});
