import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { GoalsService } from './goals.service';

@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  list(@CurrentUser() owner: OwnerIdentity) {
    return this.goals.list(owner.userId);
  }

  // The terms travel in the body, not the address: sums and dates stay out of URLs and proxy
  // logs. It stores nothing, so it answers 200, not 201.
  @Post('preview')
  @HttpCode(200)
  preview(@CurrentUser() owner: OwnerIdentity, @Body() body: unknown) {
    return this.goals.preview(owner.userId, body);
  }

  @Post()
  create(@CurrentUser() owner: OwnerIdentity, @Body() body: unknown) {
    return this.goals.create(owner.userId, body);
  }

  @Get(':id')
  get(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string) {
    return this.goals.get(owner.userId, id);
  }

  @Put(':id')
  update(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string, @Body() body: unknown) {
    return this.goals.update(owner.userId, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string) {
    return this.goals.remove(owner.userId, id);
  }
}
