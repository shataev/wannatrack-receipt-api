import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptsService } from './receipts.service';
import { HttpService } from '@nestjs/axios';
import { Express } from 'express';
import { of } from 'rxjs';

describe('ReceiptsService', () => {
  let service: ReceiptsService;
  let httpServiceMock: Partial<HttpService>;

  beforeEach(async () => {
    // Create a mock HttpService with a predefined async response
    httpServiceMock = {
      post: jest.fn().mockReturnValue(
        of({
          data: {
            type: 'receipt',
            total: 123.45,
            currency: 'THB',
            merchant: 'Demo Store',
            confidence: 0.95,
            date: '2024-01-15',
            items: [],
            language: 'en',
          },
        }),
      ),
    };

    // Set up the NestJS testing module and inject the mock
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptsService,
        { provide: HttpService, useValue: httpServiceMock }, // Inject mock instead of real HttpService
      ],
    }).compile();

    // Get an instance of ReceiptsService from the testing module
    service = module.get<ReceiptsService>(ReceiptsService);
  });

  it('should be defined', () => {
    // Verify that the service was instantiated correctly
    expect(service).toBeDefined();
  });

  it('should return structured receipt data from file', async () => {
    // Create a mock file to simulate Multer file upload
    const mockFile = {
      originalname: 'receipt.jpg',
      buffer: Buffer.from('fake image'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    // Call the service method with the mock file
    const result = await service.analyzeFile(mockFile);

    // Verify that the service returns the expected structured data
    expect(result).toEqual({
      type: 'receipt',
      total: 123.45,
      currency: 'THB',
      merchant: 'Demo Store',
      confidence: 0.95,
      date: expect.any(String),
      items: [],
      language: 'en',
    });
  });

  it('should return structured receipt data from text', async () => {
    const mockText = 'Receipt text content';

    // Call the service method with the mock text
    const result = await service.analyzeText(mockText);

    // Verify that the service returns the expected structured data
    expect(result).toEqual({
      type: 'receipt',
      total: 123.45,
      currency: 'THB',
      merchant: 'Demo Store',
      confidence: 0.95,
      date: expect.any(String),
      items: [],
      language: 'en',
    });
  });

  it('should call HttpService.post with the file', async () => {
    // Create another mock file for testing delegation
    const mockFile = {
      originalname: 'receipt.jpg',
      buffer: Buffer.from('fake image'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    // Call the service method
    await service.analyzeFile(mockFile);

    // Ensure that HttpService.post was called
    expect(httpServiceMock.post).toHaveBeenCalledTimes(1);
    expect(httpServiceMock.post).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/analyze',
      expect.any(Object), // FormData object
      expect.objectContaining({
        headers: expect.any(Object),
      }),
    );
  });
});