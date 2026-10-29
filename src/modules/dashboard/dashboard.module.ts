import { EventModule } from '../event/event.module';
import { InternalEventsController } from './controllers/internal-events.controller';
import { InternalEventsService } from './services/internal-events.service';
import { CreatorsController } from './controllers/creators.controller';
import { CreatorsService } from './services/creators.service';
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
  imports: [PrismaModule, EventModule],
  controllers: [
    InternalEventsController,
    CreatorsController,
    DashboardController,
    EventsDashboardController,
    PaymentsController,
    EventsController,
    QuickAccessController,
  ],
  providers: [
    InternalEventsService,
    CreatorsService,
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
