import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiClientService } from './ai-client.service';

describe('AiClientService', () => {
  let service: AiClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiClientService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => (key === 'AI_SERVICE_URL' ? 'http://127.0.0.1:8000' : undefined)) },
        },
      ],
    }).compile();

    service = module.get<AiClientService>(AiClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
