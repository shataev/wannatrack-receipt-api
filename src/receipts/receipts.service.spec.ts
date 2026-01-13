import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptsService } from './receipts.service';
import { AiClientService } from './ai-client/ai-client.service';
import { Express } from 'express';

describe('ReceiptsService', () => {
  let service: ReceiptsService;
  let aiClientMock: Partial<AiClientService>;

  beforeEach(async () => {
    // Create a mock AiClientService with a predefined async response
    aiClientMock = {
      processReceipt: jest.fn().mockResolvedValue({
        amount: 123.45,
        currency: 'THB',
        merchant: 'Demo Store',
        confidence: 0.95,
      }),
    };

    // Set up the NestJS testing module and inject the mock
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptsService,
        { provide: AiClientService, useValue: aiClientMock }, // Inject mock instead of real AI client
      ],
    }).compile();

    // Get an instance of ReceiptsService from the testing module
    service = module.get<ReceiptsService>(ReceiptsService);
  });

  it('should be defined', () => {
    // Verify that the service was instantiated correctly
    expect(service).toBeDefined();
  });

  it('should return structured receipt data', async () => {
    // Create a mock file to simulate Multer file upload
    const mockFile = {
      originalname: 'receipt.jpg',
      buffer: Buffer.from('fake image'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    // Call the service method with the mock file
    const result = await service.analyze(mockFile);

    // Verify that the service returns the expected structured data
    expect(result).toEqual({
      amount: 123.45,
      currency: 'THB',
      merchant: 'Demo Store',
      confidence: 0.95,
    });
  });

  it('should call AiClientService.processReceipt with the file', async () => {
    // Create another mock file for testing delegation
    const mockFile = {
      originalname: 'receipt.jpg',
      buffer: Buffer.from('fake image'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    // Call the service method
    await service.analyze(mockFile);

    // Ensure that AiClientService.processReceipt was called with the correct file
    expect(aiClientMock.processReceipt).toHaveBeenCalledWith(mockFile);
    // Ensure it was called exactly once
    expect(aiClientMock.processReceipt).toHaveBeenCalledTimes(1);
  });
});