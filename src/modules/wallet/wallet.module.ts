import { Module } from '@nestjs/common';
import { NotificationModule } from 'src/modules/notification/notification.module';
import { PaystackModule } from 'src/modules/paystack/paystack.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { WalletController } from './controller/wallet.controller';
import { DikriptService } from './service/dikript.service';
import { WalletService } from './service/wallet.service';

@Module({
  imports: [PrismaModule, NotificationModule, PaystackModule],
  controllers: [WalletController],
  providers: [WalletService, DikriptService],
  exports: [WalletService],
})
export class WalletModule {}
