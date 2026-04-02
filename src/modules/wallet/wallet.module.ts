import { Module } from '@nestjs/common';
import { NotificationModule } from 'src/modules/notification/notification.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { WalletController } from './controller/wallet.controller';
import { QoreIdService } from './service/qoreid.service';
import { WalletService } from './service/wallet.service';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [WalletController],
  providers: [WalletService, QoreIdService],
  exports: [WalletService],
})
export class WalletModule {}
