import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, type OwnerIdentity } from '../shared/decorators';
import { CsvImportService } from './csv-import.service';
import { CsvUploadInterceptor, type CsvUploadRequest } from './csv-upload.interceptor';

@Controller('accounting/accounts/:id/csv-imports')
export class CsvImportController {
  constructor(private readonly imports: CsvImportService) {}
  @Post()
  @UseInterceptors(CsvUploadInterceptor)
  async upload(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Req() request: CsvUploadRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.csvUpload) throw new BadRequestException('Invalid CSV upload');
    const result = await this.imports.upload(owner.userId, id, request.csvUpload);
    response.status(result.created ? 201 : 200);
    return result.value;
  }
  @Get()
  list(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string, @Query() query: unknown) {
    return this.imports.list(owner.userId, id, query);
  }
  @Get(':batchId')
  detail(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
  ) {
    return this.imports.detail(owner.userId, id, batchId);
  }
  @Get(':batchId/rows')
  rows(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @Query() query: unknown,
  ) {
    return this.imports.rows(owner.userId, id, batchId, query);
  }
  @Get(':batchId/reconciliation')
  reconciliation(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @Query() query: unknown,
  ) {
    return this.imports.reconciliation(owner.userId, id, batchId, query);
  }
  @Post(':batchId/inspect')
  @HttpCode(200)
  inspect(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @Body() input: unknown,
  ) {
    return this.imports.inspect(owner.userId, id, batchId, input);
  }
  @Post(':batchId/preview')
  @HttpCode(200)
  preview(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @Body() input: unknown,
  ) {
    return this.imports.preview(owner.userId, id, batchId, input);
  }
  @Post(':batchId/confirm')
  async confirm(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.imports.confirm(owner.userId, id, batchId, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }
  @Post(':batchId/rollback')
  async rollback(
    @CurrentUser() owner: OwnerIdentity,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.imports.rollback(owner.userId, id, batchId, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }
}
