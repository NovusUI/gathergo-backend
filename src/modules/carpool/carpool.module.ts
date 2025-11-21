import { Module } from '@nestjs/common';
import { CarpoolService } from './carpool.service';
import { CarpoolController } from './carpool.controller';
import { GuardsModule } from 'src/common/guards/guards.module';
import { MessageModule } from '../message/message.module';

@Module({
  imports: [GuardsModule, MessageModule],
  controllers: [CarpoolController],
  providers: [CarpoolService],
})
export class CarpoolModule {}
