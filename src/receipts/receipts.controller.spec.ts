import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { Express } from 'express';

describe('ReceiptsController', () => {
  let controller: ReceiptsController;
  let serviceMock: Partial<ReceiptsService>;

  beforeEach(async () => {
    // Create a mock of ReceiptsService with predefined responses
    serviceMock = {
      analyzeText: jest.fn().mockResolvedValue({
        amount: 123.45,
        currency: 'THB',
        merchant: 'Demo Store',
        confidence: 0.95,
      }),
      analyzeFile: jest.fn().mockResolvedValue({
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

  it('should return analyzed receipt data from text', async () => {
    const mockText = 'Receipt text content';

    // Call the controller method with text
    const result = await controller.analyze(undefined, mockText);

    // Verify that the controller returns the mocked service response
    expect(result).toEqual({
      amount: 123.45,
      currency: 'THB',
      merchant: 'Demo Store',
      confidence: 0.95,
    });

    // Ensure that the controller called ReceiptsService.analyzeText with the correct text
    expect(serviceMock.analyzeText).toHaveBeenCalledWith(mockText);
    expect(serviceMock.analyzeText).toHaveBeenCalledTimes(1);
  });

  it('should return analyzed receipt data from file', async () => {
    // Create a mock file to simulate Multer file upload
    const mockFile = {
      originalname: 'receipt.jpg',
      buffer: Buffer.from('fake image'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    // Call the controller method with file
    const result = await controller.analyze(mockFile, undefined);

    // Verify that the controller returns the mocked service response
    expect(result).toEqual({
      amount: 123.45,
      currency: 'THB',
      merchant: 'Demo Store',
      confidence: 0.95,
    });

    // Ensure that the controller called ReceiptsService.analyzeFile with the correct file
    expect(serviceMock.analyzeFile).toHaveBeenCalledWith(mockFile);
    expect(serviceMock.analyzeFile).toHaveBeenCalledTimes(1);
  });

  it('should throw error when no input provided', () => {
    // Call the controller method without file or text
    expect(() => controller.analyze(undefined, undefined)).toThrow(
      'No input provided',
    );
  });
});