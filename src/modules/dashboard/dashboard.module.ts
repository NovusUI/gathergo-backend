import { Module } from '@nestjs/common';
import { DashboardController } from './controllers/dashboard.controller';
import { EventsDashboardController } from './controllers/events-dashboard.controller';
import { PaymentsController } from './controllers/payments.controller';
import { EventsController } from './controllers/events.controller';
import { DashboardService } from './services/dashboard.service';
import { EventsDashboardService } from './services/events-dashboard.service';
import { PaymentsService } from './services/payments.service';
import { EventsService } from './services/events.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { QuickAccessController } from './controllers/quick-access.controller';
import { QuickAccessService } from './services/quick-access.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    DashboardController,
    EventsDashboardController,
    PaymentsController,
    EventsController,
    QuickAccessController,
  ],
  providers: [
    DashboardService,
    EventsDashboardService,
    PaymentsService,
    EventsService,
    QuickAccessService,
  ],
  exports: [
    DashboardService,
    EventsDashboardService,
    PaymentsService,
    EventsService,
    QuickAccessService,
  ],
})
export class DashboardModule {}
