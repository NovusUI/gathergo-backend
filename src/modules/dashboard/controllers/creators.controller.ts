import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentDashboard,
  DashboardAccess,
} from 'src/modules/dashboard-auth/dashboard-access';
import type { DashboardSessionContext } from 'src/modules/dashboard-auth/dashboard-auth.types';
import { CreatorsQueryDto } from '../dto/creators-query.dto';
import { CreatorsService } from '../services/creators.service';

@ApiTags('Dashboard creators')
@ApiBearerAuth()
@Controller('dashboard/internal/creators')
@DashboardAccess('read')
export class CreatorsController {
  constructor(private readonly creators: CreatorsService) {}

  @Get()
  @ApiOperation({
    summary: 'Search creators and inspect payout and KYC status',
  })
  async list(
    @Query() dto: CreatorsQueryDto,
    @CurrentDashboard() session: DashboardSessionContext,
  ) {
    return { data: await this.creators.list(dto, session.user) };
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Inspect a creator profile, event activity and recorded payment totals',
  })
  detail(
    @Param('id') id: string,
    @CurrentDashboard() session: DashboardSessionContext,
  ) {
    return this.creators.detail(id, session.user);
  }
}
