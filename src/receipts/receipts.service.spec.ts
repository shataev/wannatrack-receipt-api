import { ReceiptsService } from './receipts.service';

describe('ReceiptsService', () => {
  let service: ReceiptsService;

  beforeEach(() => {
    service = new ReceiptsService();
  });

  it('should extract structured data from receipt image', async () => {
    const mockFile = {
      originalname: 'receipt.jpg',
      buffer: Buffer.from('fake image'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    const result = await service.analyze(mockFile);

    expect(result).toEqual({
      amount: expect.any(Number),
      currency: expect.any(String),
      merchant: expect.any(String),
      confidence: expect.any(Number),
    });
  });
});