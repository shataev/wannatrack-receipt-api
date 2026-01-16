import {
    Controller,
    Post,
    UploadedFile,
    UseInterceptors,
    Body,
  } from '@nestjs/common';
  import { FileInterceptor } from '@nestjs/platform-express';
  import { ReceiptsService } from './receipts.service';
  import { ReceiptResultDto } from './dto/receipt-result.dto';
  
  @Controller('receipts')
  export class ReceiptsController {
    constructor(private readonly receiptsService: ReceiptsService) {}
  
    @Post('analyze/text')
    analyzeText(@Body('text') text: string) {
      return this.receiptsService.analyzeText(text);
    }

    @Post('analyze/receipt')
    @UseInterceptors(FileInterceptor('file'))
    analyzeReceipt(@UploadedFile() file: Express.Multer.File) {
      return this.receiptsService.analyzeFile(file);
    }
  }