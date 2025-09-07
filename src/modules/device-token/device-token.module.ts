import { Module } from '@nestjs/common';
import { DeviceTokenService } from './device-token.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { DeviceTokenController } from './device-token.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DeviceTokenController],
  providers: [DeviceTokenService],
  exports: [DeviceTokenService],
})
export class DeviceTokenModule {}
