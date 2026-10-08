import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { type ExportDownload, OwnerExportService } from './owner-export.service';

// Settings → Data (M19): the owner's data as a download, never cached.
@Controller('export')
export class OwnerExportController {
  constructor(private readonly exports: OwnerExportService) {}

  @Get('csv')
  async csv(@CurrentUser() owner: OwnerIdentity, @Res() response: Response) {
    send(response, await this.exports.archive(owner.userId));
  }

  @Get('backup')
  async backup(@CurrentUser() owner: OwnerIdentity, @Res() response: Response) {
    send(response, await this.exports.backup(owner.userId));
  }
}

function send(response: Response, download: ExportDownload) {
  response
    .status(200)
    .set({
      'Content-Type': download.contentType,
      'Content-Disposition': `attachment; filename="${download.filename}"`,
      'Content-Length': String(download.data.length),
      'Cache-Control': 'no-store',
    })
    .end(download.data);
}
