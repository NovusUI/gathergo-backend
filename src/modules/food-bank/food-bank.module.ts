import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FoodBankController } from './food-bank.controller';
import { FoodBankService } from './food-bank.service';
@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [FoodBankController],
  providers: [FoodBankService],
  exports: [FoodBankService],
})
export class FoodBankModule {}
