import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { Express } from 'express';

describe('ReceiptsController', () => {
  let controller: ReceiptsController;
  let serviceMock: Partial<ReceiptsService>;

  beforeEach(async () => {
    // Create a mock of ReceiptsService with a predefined response
    serviceMock = {
      analyze: jest.fn().mockResolvedValue({
        amount: 123.45,
        currency: 'THB',
        merchant: 'Demo Store',
        confidence: 0.95,
      }),
    };

    // Create a NestJS testing module and inject the mock service
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReceiptsController],
      providers: [
        { provide: ReceiptsService, useValue: serviceMock }, // Inject mock instead of real service
      ],
    }).compile();

    // Get an instance of ReceiptsController from the module
    controller = module.get<ReceiptsController>(ReceiptsController);
  });

  it('should be defined', () => {
    // Ensure the controller instance was created
    expect(controller).toBeDefined();
  });

  it('should return analyzed receipt data', async () => {
    // Create a mock file to simulate Multer file upload
    const mockFile = {
      originalname: 'receipt.jpg',
      buffer: Buffer.from('fake image'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    // Call the controller method
    const result = await controller.analyzeReceipt(mockFile);

    // Verify that the controller returns the mocked service response
    expect(result).toEqual({
      amount: 123.45,
      currency: 'THB',
      merchant: 'Demo Store',
      confidence: 0.95,
    });

    // Ensure that the controller called ReceiptsService.analyze with the correct file
    expect(serviceMock.analyze).toHaveBeenCalledWith(mockFile);
    expect(serviceMock.analyze).toHaveBeenCalledTimes(1);
  });
});