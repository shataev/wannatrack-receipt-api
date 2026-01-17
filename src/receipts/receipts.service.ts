import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data';

@Injectable()
export class ReceiptsService {
  constructor(private readonly http: HttpService) {}

  private readonly AI_URL = 'http://127.0.0.1:8000/analyze';

  async analyzeText(text: string) {
    const form = new FormData();
    form.append('text', text);

    const response$ = this.http.post(this.AI_URL, form, {
      headers: form.getHeaders(),
    });

    const { data } = await firstValueFrom(response$);
    return data;
  }

  async analyzeFile(file: Express.Multer.File) {
    const form = new FormData();
    form.append('file', file.buffer, file.originalname);

    const response$ = this.http.post(this.AI_URL, form, {
      headers: form.getHeaders(),
    });

    const { data } = await firstValueFrom(response$);
    return data;
  }
}