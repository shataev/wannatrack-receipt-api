import { Injectable, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';
import { ReceiptResultDto } from '../dto/receipt-result.dto';
import { ReceiptAnalyzer } from './receipt-analyzer.interface';

@Injectable()
export class AiClientService implements ReceiptAnalyzer {
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('AI_SERVICE_URL') || 'http://127.0.0.1:8000';
  }

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
