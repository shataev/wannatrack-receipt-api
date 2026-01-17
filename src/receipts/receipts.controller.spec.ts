import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ReceiptsService } from './receipts.service';

@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Post('analyze')
  @UseInterceptors(FileInterceptor('file'))
  analyze(
    @UploadedFile() file?: Express.Multer.File,
    @Body('text') text?: string,
  ) {
    if (text) {
      return this.receiptsService.analyzeText(text);
    }

    if (file) {
      return this.receiptsService.analyzeFile(file);
    }

    throw new Error('No input provided');
  }
}