import { ReceiptItemDto } from './receipt-item.dto';

export class ReceiptResultDto {
  type: 'receipt' | 'text';
  merchant?: string | null;
  total: number;
  currency: string;
  date?: string | null;
  items: ReceiptItemDto[];
  confidence: number;
  language: string;
}