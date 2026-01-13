import { Test, TestingModule } from '@nestjs/testing';
import { AiClientService } from './ai-client.service';

describe('AiClientService', () => {
  let service: AiClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiClientService],
    }).compile();

    service = module.get<AiClientService>(AiClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
