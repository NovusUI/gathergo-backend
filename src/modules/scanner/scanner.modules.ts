import { FoodBankModule } from '../food-bank/food-bank.module';
import { Module } from '@nestjs/common';
import { ScannerService } from './scanner.service';
import { ScannerController } from './scanner.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ScannerPermissionsController } from './permisions/scanner-permissions.controller';
import { ScannerPermissionsService } from './permisions/ scanner-permissions.service';
import { ScannerGuard } from 'src/common/guards/scanner.guard';

@Module({
  imports: [PrismaModule, FoodBankModule],
  controllers: [ScannerController, ScannerPermissionsController],
  providers: [ScannerService, ScannerPermissionsService, ScannerGuard],
  exports: [ScannerService, ScannerPermissionsService],
})
export class ScannerModule {}
