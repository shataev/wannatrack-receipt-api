import { ReceiptResultDto } from '../dto/receipt-result.dto';

/**
 * Contract for receipt analysis (text or file).
 * Implementations: AiClientService (external AI), LocalAnalyzerService (stub).
 */
export interface ReceiptAnalyzer {
  analyzeText(text: string): Promise<ReceiptResultDto>;
  analyzeFile(file: Express.Multer.File): Promise<ReceiptResultDto>;
}

export const RECEIPT_ANALYZER = Symbol('RECEIPT_ANALYZER');
