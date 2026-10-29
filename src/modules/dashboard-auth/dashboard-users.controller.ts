import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentDashboard, DashboardAccess } from './dashboard-access';
import { DashboardAuthService } from './dashboard-auth.service';
import {
  CreateDashboardUserDto,
  DashboardPasswordDto,
  DashboardUsersQueryDto,
  UpdateDashboardUserDto,
} from './dashboard-auth.dto';
import type { DashboardSessionContext } from './dashboard-auth.types';

@ApiTags('Dashboard accounts')
@Controller('dashboard/users')
@DashboardAccess('admin')
export class DashboardUsersController {
  constructor(private readonly auth: DashboardAuthService) {}

  @Get()
  list(
    @Query() dto: DashboardUsersQueryDto,
    @CurrentDashboard() session: DashboardSessionContext,
  ) {
    return this.auth.listUsers(dto, session.user);
  }

  @Post()
  create(
    @Body() dto: CreateDashboardUserDto,
    @CurrentDashboard() session: DashboardSessionContext,
  ) {
    return this.auth.createUser(dto, session.user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDashboardUserDto,
    @CurrentDashboard() session: DashboardSessionContext,
  ) {
    return this.auth.updateUser(id, dto, session.user);
  }

  @Post(':id/password')
  resetPassword(
    @Param('id') id: string,
    @Body() dto: DashboardPasswordDto,
    @CurrentDashboard() session: DashboardSessionContext,
  ) {
    return this.auth.resetPassword(id, dto, session.user);
  }
}
