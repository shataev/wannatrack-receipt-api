import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import * as path from 'path';

describe('ReceiptsController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/receipts/analyze (POST) - should return structured receipt data', async () => {
    const filePath = path.join(__dirname, 'receipt-mock.jpg');

    const response = await request(app.getHttpServer())
      .post('/receipts/analyze')
      .attach('file', filePath)
      .expect(201);

    expect(response.body).toEqual({
      amount: 123.45,
      currency: 'THB',
      merchant: 'Demo Store',
      confidence: 0.95,
    });
  });
});