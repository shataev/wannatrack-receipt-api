import { Injectable, HttpException } from '@nestjs/common';
import axios from 'axios';
import FormData from 'form-data';
import { ReceiptResultDto } from '../dto/receipt-result.dto';
import { Express } from 'express';

@Injectable()
export class AiClientService {
  private readonly baseUrl = 'http://127.0.0.1:8000';

  async analyzeText(text: string): Promise<ReceiptResultDto> {
    try {
      const formData = new FormData();
      formData.append('text', text);

      const response = await axios.post(
        `${this.baseUrl}/analyze`,
        formData,
        { headers: formData.getHeaders() },
      );

      return response.data;
    } catch (error) {
      throw new HttpException('AI service error', 502);
    }
  }

  async analyzeFile(file: Express.Multer.File): Promise<ReceiptResultDto> {
    try {
      const formData = new FormData();
      formData.append('file', file.buffer, file.originalname);

      const response = await axios.post(
        `${this.baseUrl}/analyze`,
        formData,
        { headers: formData.getHeaders() },
      );

      return response.data;
    } catch (error) {
      throw new HttpException('AI service error', 502);
    }
  }
}