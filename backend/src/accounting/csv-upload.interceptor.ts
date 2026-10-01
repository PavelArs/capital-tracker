import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { Request } from 'express';
import { EMPTY } from 'rxjs';
import { decodeDisplayName, validateCsvSource } from './csv-input';

const limits: NonNullable<MulterOptions['limits']> & {
  fieldNestingDepth: number;
  fieldArrayIndexLimit: number;
} = {
  fileSize: 262144,
  files: 1,
  fields: 1,
  fieldSize: 641,
  fieldNameSize: 32,
  parts: 3,
  fieldNestingDepth: 0,
  fieldArrayIndexLimit: 0,
};
const MultipartFile = FileInterceptor('file', { limits, preservePath: false });
export interface CsvUpload {
  filename: string;
  bytes: Buffer;
}
export interface CsvUploadRequest extends Request {
  csvUpload?: CsvUpload;
  file?: unknown;
}
function invalid() {
  return new BadRequestException('Invalid CSV upload');
}
function uploadBody(raw: unknown): { displayNameBase64url: unknown } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== 'displayNameBase64url') throw invalid();
  return raw as { displayNameBase64url: unknown };
}
function fileBuffer(raw: unknown): Buffer {
  if (!raw || typeof raw !== 'object' || !('buffer' in raw)) throw invalid();
  return validateCsvSource(raw.buffer);
}
@Injectable()
export class CsvUploadInterceptor implements NestInterceptor {
  private readonly multipart = new MultipartFile();
  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<CsvUploadRequest>();
    const encoding = request.headers['content-encoding'];
    if (!request.is('multipart/form-data') || (encoding !== undefined && encoding !== 'identity'))
      throw new UnsupportedMediaTypeException('Unsupported CSV upload transport');
    // Isolate parsing from the real handler so its conflict/storage errors stay intact.
    try {
      await this.multipart.intercept(context, { handle: () => EMPTY });
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 413)
        throw new PayloadTooLargeException('CSV upload is too large');
      throw invalid();
    }
    const body = uploadBody(request.body as unknown);
    request.csvUpload = {
      filename: decodeDisplayName(body.displayNameBase64url),
      bytes: fileBuffer(request.file),
    };
    return next.handle();
  }
}
