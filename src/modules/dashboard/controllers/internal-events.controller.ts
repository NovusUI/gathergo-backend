import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CurrentDashboard,
  DashboardAccess,
} from 'src/modules/dashboard-auth/dashboard-access';
import type { DashboardSessionContext } from 'src/modules/dashboard-auth/dashboard-auth.types';
import {
  InternalEventsQueryDto,
  UpdateInternalEventDto,
} from '../dto/internal-events.dto';
import { InternalEventsService } from '../services/internal-events.service';

@ApiTags('Platform events')
@ApiBearerAuth()
@Controller('dashboard/internal/events')
@DashboardAccess('read')
export class InternalEventsController {
  constructor(private readonly events: InternalEventsService) {}
  @Get() async list(
    @Query() dto: InternalEventsQueryDto,
    @CurrentDashboard() session: DashboardSessionContext,
  ) {
    return { data: await this.events.list(dto, session.user) };
  }
  @Get(':id') detail(
    @Param('id') id: string,
    @CurrentDashboard() session: DashboardSessionContext,
  ) {
    return this.events.detail(id, session.user);
  }
  @Patch(':id')
  @DashboardAccess('admin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInternalEventDto,
    @CurrentDashboard() session: DashboardSessionContext,
  ) {
    return this.events.update(id, dto, session.user);
  }
}
