import { Module } from '@nestjs/common';
import { DisplayFxController } from './display-fx.controller';
import { DisplayFxService } from './display-fx.service';
import { DisplayFxProvider } from './display-fx-provider';

@Module({
  controllers: [DisplayFxController],
  providers: [DisplayFxProvider, DisplayFxService],
})
export class DisplayFxModule {}
