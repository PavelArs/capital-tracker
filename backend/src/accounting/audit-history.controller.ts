import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { AuditHistoryService } from './audit-history.service';

@Controller('accounting/audit-history')
export class AuditHistoryController {
  constructor(private readonly history: AuditHistoryService) {}

  @Get()
  read(@CurrentUser() owner: OwnerIdentity, @Query() query: unknown) {
    return this.history.read(owner.userId, query);
  }
}
