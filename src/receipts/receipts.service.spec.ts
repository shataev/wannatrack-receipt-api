import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptsService } from './receipts.service';
import { RECEIPT_ANALYZER, ReceiptAnalyzer } from './ai-client/receipt-analyzer.interface';
import { Express } from 'express';

describe('ReceiptsService', () => {
  let service: ReceiptsService;
  let analyzerMock: Partial<ReceiptAnalyzer>;

  const mockResult = {
    type: 'receipt' as const,
    total: 123.45,
    currency: 'THB',
    merchant: 'Demo Store',
    confidence: 0.95,
    date: '2024-01-15',
    items: [],
    language: 'en',
  };

  beforeEach(async () => {
    analyzerMock = {
      analyzeText: jest.fn().mockResolvedValue(mockResult),
      analyzeFile: jest.fn().mockResolvedValue(mockResult),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptsService,
        { provide: RECEIPT_ANALYZER, useValue: analyzerMock },
      ],
    }).compile();

    service = module.get<ReceiptsService>(ReceiptsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return structured receipt data from file', async () => {
    const mockFile = {
      originalname: 'receipt.jpg',
      buffer: Buffer.from('fake image'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    const result = await service.analyzeFile(mockFile);

    expect(analyzerMock.analyzeFile).toHaveBeenCalledWith(mockFile);
    expect(result).toEqual({
      ...mockResult,
      date: expect.any(String),
    });
  });

  it('should return structured receipt data from text', async () => {
    const mockText = 'Receipt text content';

    const result = await service.analyzeText(mockText);

    expect(analyzerMock.analyzeText).toHaveBeenCalledWith(mockText);
    expect(result).toEqual({
      ...mockResult,
      date: expect.any(String),
    });
  });

  it('should call analyzer.analyzeFile once', async () => {
    const mockFile = {
      originalname: 'receipt.jpg',
      buffer: Buffer.from('fake image'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    await service.analyzeFile(mockFile);

    expect(analyzerMock.analyzeFile).toHaveBeenCalledTimes(1);
    expect(analyzerMock.analyzeFile).toHaveBeenCalledWith(mockFile);
  });
});
