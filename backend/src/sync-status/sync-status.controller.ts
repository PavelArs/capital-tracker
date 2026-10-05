import { Controller, Get } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { SyncStatusService } from './sync-status.service';

@Controller('sync-status')
export class SyncStatusController {
  constructor(private readonly status: SyncStatusService) {}

  @Get()
  read(@CurrentUser() owner: OwnerIdentity) {
    return this.status.read(owner.userId);
  }
}
