import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import {
  CoreApiService,
  TelegramAccountNotLinkedError,
} from './core-api.service';

const BOT_SECRET = 'test-bot-secret';
const TELEGRAM_ID = 123456789;

interface RequestConfig {
  headers: Record<string, string>;
  params?: Record<string, unknown>;
}

describe('CoreApiService', () => {
  let service: CoreApiService;
  let http: { get: jest.Mock; post: jest.Mock; put: jest.Mock };

  beforeEach(async () => {
    http = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoreApiService,
        { provide: HttpService, useValue: http },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string) =>
                ({
                  API_BASE_URL: 'http://core.test',
                  TELEGRAM_BOT_SECRET: BOT_SECRET,
                })[key],
            ),
          },
        },
      ],
    }).compile();

    service = module.get(CoreApiService);
  });

  const unauthorized = () =>
    throwError(() => ({ message: 'Unauthorized', response: { status: 401 } }));

  function expectIdentityHeaders(config: RequestConfig) {
    expect(config.headers).toEqual(
      expect.objectContaining({
        'X-Telegram-Bot-Secret': BOT_SECRET,
        'X-Telegram-User-Id': String(TELEGRAM_ID),
      }),
    );
  }

  function expectNoUserId(url: string, config: RequestConfig, body?: object) {
    expect(url).not.toMatch(/userId/);
    expect(config.params?.userId).toBeUndefined();
    if (body !== undefined) {
      expect(body).not.toHaveProperty('userId');
    }
  }

  describe('getUserIdByTelegramId', () => {
    it('sends both identity headers', async () => {
      http.get.mockReturnValue(of({ data: { userId: 'u1' } }));

      await expect(service.getUserIdByTelegramId(TELEGRAM_ID)).resolves.toBe(
        'u1',
      );

      const [url, config] = http.get.mock.calls[0] as [string, RequestConfig];
      expect(url).toBe(
        `http://core.test/api/telegram/user-by-telegram/${TELEGRAM_ID}`,
      );
      expectIdentityHeaders(config);
      expectNoUserId(url, config);
    });
  });

  describe('getCategories', () => {
    it('sends both identity headers and no userId', async () => {
      const categories = [{ name: 'Food', value: 'c1' }];
      http.get.mockReturnValue(of({ data: categories }));

      await expect(service.getCategories(TELEGRAM_ID)).resolves.toEqual(
        categories,
      );

      const [url, config] = http.get.mock.calls[0] as [string, RequestConfig];
      expect(url).toBe('http://core.test/api/category');
      expectIdentityHeaders(config);
      expectNoUserId(url, config);
    });

    it('turns a 401 into TelegramAccountNotLinkedError', async () => {
      http.get.mockReturnValue(unauthorized());

      await expect(service.getCategories(TELEGRAM_ID)).rejects.toBeInstanceOf(
        TelegramAccountNotLinkedError,
      );
    });
  });

  describe('getFunds', () => {
    it('sends both identity headers and no userId', async () => {
      http.get.mockReturnValue(of({ data: { funds: [{ _id: 'f1' }] } }));

      await expect(service.getFunds(TELEGRAM_ID)).resolves.toEqual([
        { _id: 'f1' },
      ]);

      const [url, config] = http.get.mock.calls[0] as [string, RequestConfig];
      expect(url).toBe('http://core.test/api/funds');
      expectIdentityHeaders(config);
      expectNoUserId(url, config);
    });

    it('turns a 401 into TelegramAccountNotLinkedError instead of an empty list', async () => {
      http.get.mockReturnValue(unauthorized());

      await expect(service.getFunds(TELEGRAM_ID)).rejects.toBeInstanceOf(
        TelegramAccountNotLinkedError,
      );
    });
  });

  describe('createCost', () => {
    it('sends both identity headers and no userId in the body', async () => {
      http.post.mockReturnValue(of({ data: { ok: true } }));
      const payload = {
        amount: 100,
        category: 'c1',
        comment: 'Shop',
        date: '2026-10-09T00:00:00.000Z',
        fundId: 'f1',
      };

      await service.createCost(TELEGRAM_ID, payload);

      const [url, body, config] = http.post.mock.calls[0] as [
        string,
        object,
        RequestConfig,
      ];
      expect(url).toBe('http://core.test/api/cost');
      expect(body).toEqual(payload);
      expectIdentityHeaders(config);
      expectNoUserId(url, config, body);
    });

    it('sends currency and an explicit empty tag list as given', async () => {
      http.post.mockReturnValue(of({ data: {} }));
      const payload = {
        amount: 1500,
        category: 'c1',
        date: '2026-10-09T00:00:00.000Z',
        currency: 'JPY',
        tags: [],
      };

      await service.createCost(TELEGRAM_ID, payload);

      const [, body] = http.post.mock.calls[0] as [string, object];
      expect(body).toEqual(payload);
    });

    it('returns the saved cost', async () => {
      const saved = {
        amount: 1500,
        currency: 'JPY',
        fundAmount: 352.4,
        tags: ['japan-2026'],
      };
      http.post.mockReturnValue(of({ data: saved }));

      await expect(
        service.createCost(TELEGRAM_ID, {
          amount: 1500,
          category: 'c1',
          date: '2026-10-09T00:00:00.000Z',
        }),
      ).resolves.toEqual(saved);
    });

    it('turns a 401 into TelegramAccountNotLinkedError', async () => {
      http.post.mockReturnValue(unauthorized());

      await expect(
        service.createCost(TELEGRAM_ID, {
          amount: 1,
          category: 'c1',
          date: '2026-10-09T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(TelegramAccountNotLinkedError);
    });

    it('passes other errors through unchanged', async () => {
      const insufficient = {
        message: 'Bad Request',
        response: { status: 400, data: { error: 'Insufficient funds' } },
      };
      http.post.mockReturnValue(throwError(() => insufficient));

      await expect(
        service.createCost(TELEGRAM_ID, {
          amount: 1,
          category: 'c1',
          date: '2026-10-09T00:00:00.000Z',
        }),
      ).rejects.toBe(insufficient);
    });
  });

  describe('getMe', () => {
    it('reads GET /api/me with both identity headers', async () => {
      http.get.mockReturnValue(of({ data: { activeTag: 'japan-2026' } }));

      await expect(service.getMe(TELEGRAM_ID)).resolves.toEqual({
        activeTag: 'japan-2026',
      });

      const [url, config] = http.get.mock.calls[0] as [string, RequestConfig];
      expect(url).toBe('http://core.test/api/me');
      expectIdentityHeaders(config);
      expectNoUserId(url, config);
    });

    it('turns a 401 into TelegramAccountNotLinkedError', async () => {
      http.get.mockReturnValue(unauthorized());

      await expect(service.getMe(TELEGRAM_ID)).rejects.toBeInstanceOf(
        TelegramAccountNotLinkedError,
      );
    });
  });

  describe('setActiveTag', () => {
    it('PUTs { tag } to /api/me/active-tag and returns the user', async () => {
      http.put.mockReturnValue(of({ data: { activeTag: 'japan-2026' } }));

      await expect(
        service.setActiveTag(TELEGRAM_ID, 'Japan 2026'),
      ).resolves.toEqual({ activeTag: 'japan-2026' });

      const [url, body, config] = http.put.mock.calls[0] as [
        string,
        object,
        RequestConfig,
      ];
      expect(url).toBe('http://core.test/api/me/active-tag');
      expect(body).toEqual({ tag: 'Japan 2026' });
      expectIdentityHeaders(config);
      expectNoUserId(url, config, body);
    });

    it('sends tag: null to clear', async () => {
      http.put.mockReturnValue(of({ data: { activeTag: null } }));

      await service.setActiveTag(TELEGRAM_ID, null);

      const [, body] = http.put.mock.calls[0] as [string, object];
      expect(body).toEqual({ tag: null });
    });

    it('turns a 401 into TelegramAccountNotLinkedError', async () => {
      http.put.mockReturnValue(unauthorized());

      await expect(
        service.setActiveTag(TELEGRAM_ID, 'x'),
      ).rejects.toBeInstanceOf(TelegramAccountNotLinkedError);
    });
  });

  describe('getTags', () => {
    it('reads GET /api/tags with both identity headers', async () => {
      const tags = [
        {
          tag: 'japan-2026',
          count: 3,
          total: 1200,
          currency: 'THB',
          firstDate: '2026-10-24T00:00:00.000Z',
          lastDate: '2026-10-25T00:00:00.000Z',
        },
      ];
      http.get.mockReturnValue(of({ data: tags }));

      await expect(service.getTags(TELEGRAM_ID)).resolves.toEqual(tags);

      const [url, config] = http.get.mock.calls[0] as [string, RequestConfig];
      expect(url).toBe('http://core.test/api/tags');
      expectIdentityHeaders(config);
      expectNoUserId(url, config);
    });

    it('turns a 401 into TelegramAccountNotLinkedError', async () => {
      http.get.mockReturnValue(unauthorized());

      await expect(service.getTags(TELEGRAM_ID)).rejects.toBeInstanceOf(
        TelegramAccountNotLinkedError,
      );
    });
  });
});
