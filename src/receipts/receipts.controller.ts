import {
    Controller,
    Post,
    UploadedFile,
    UseInterceptors,
  } from '@nestjs/common';
  import { FileInterceptor } from '@nestjs/platform-express';
  import { ReceiptsService } from './receipts.service';
  import { ReceiptResultDto } from './dto/receipt-result.dto';
  
  @Controller('receipts')
  export class ReceiptsController {
    constructor(private readonly receiptsService: ReceiptsService) {}
  
    // POST /receipts/analyze
    @Post('analyze')
    @UseInterceptors(FileInterceptor('file'))
    async analyzeReceipt(
      @UploadedFile() file: Express.Multer.File,
    ): Promise<ReceiptResultDto> {
      // Вызываем сервис, который вернет данные
      return this.receiptsService.analyze(file);
    }
  }