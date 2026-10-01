import { Module } from '@nestjs/common';
import { DisplayFxProvider } from './display-fx-provider';
import { DisplayFxController } from './display-fx.controller';
import { DisplayFxService } from './display-fx.service';

@Module({
  controllers: [DisplayFxController],
  providers: [DisplayFxProvider, DisplayFxService],
})
export class DisplayFxModule {}
