import { Module } from '@nestjs/common';
import { CarpoolService } from './carpool.service';
import { CarpoolController } from './carpool.controller';

@Module({
  controllers: [CarpoolController],
  providers: [CarpoolService],
})
export class CarpoolModule {}
