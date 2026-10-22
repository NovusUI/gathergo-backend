import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import {
  CreateVolunteerRoleDto,
  UpdateVolunteerRoleDto,
} from './dto/create-volunteer-role.dto';
import {
  ApplyToVolunteerDto,
  CompleteVolunteerDto,
  ReviewVolunteerDto,
} from './dto/volunteer-application.dto';
import { VolunteerService } from './volunteer.service';

@ApiTags('Volunteering')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class VolunteerController {
  constructor(private readonly volunteers: VolunteerService) {}

  @Get('volunteers/me')
  @ApiOperation({
    summary: 'Get my volunteer applications and contribution history',
  })
  history(@CurrentUser('id') userId: string) {
    return this.volunteers.history(userId);
  }

  @Get('events/:eventId/volunteer-roles')
  @ApiOperation({
    summary: 'Get volunteer roles, confirmed place counts, and my applications',
  })
  roles(@Param('eventId') eventId: string, @CurrentUser('id') userId: string) {
    return this.volunteers.listRoles(eventId, userId);
  }

  @Post('events/:eventId/volunteer-roles')
  @ApiOperation({
    summary: 'Add a volunteer role to a physical event with impact',
  })
  createRole(
    @Param('eventId') eventId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateVolunteerRoleDto,
  ) {
    return this.volunteers.createRole(eventId, userId, dto);
  }

  @Patch('events/:eventId/volunteer-roles/:roleId')
  @ApiOperation({
    summary:
      'Edit volunteer requirements, capacity, acceptance policy, or recruitment availability',
  })
  updateRole(
    @Param('eventId') eventId: string,
    @Param('roleId') roleId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateVolunteerRoleDto,
  ) {
    return this.volunteers.updateRole(eventId, roleId, userId, dto);
  }

  @Post('events/:eventId/volunteer-roles/:roleId/apply')
  @ApiOperation({
    summary: 'Apply or join automatically, according to the organiser’s policy',
  })
  apply(
    @Param('eventId') eventId: string,
    @Param('roleId') roleId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ApplyToVolunteerDto,
  ) {
    return this.volunteers.apply(eventId, roleId, userId, dto);
  }

  @Get('events/:eventId/volunteers')
  @ApiOperation({ summary: 'Get the event volunteer roster (organiser only)' })
  applications(
    @Param('eventId') eventId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.volunteers.listApplications(eventId, userId);
  }

  @Get('events/:eventId/volunteers/summary')
  @ApiOperation({
    summary: 'Get volunteer participation counts and organiser-confirmed hours',
  })
  summary(@Param('eventId') eventId: string) {
    return this.volunteers.summary(eventId);
  }

  @Patch('events/:eventId/volunteers/:id/review')
  @ApiOperation({
    summary: 'Accept or decline a pending volunteer application',
  })
  review(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ReviewVolunteerDto,
  ) {
    return this.volunteers.review(eventId, id, userId, dto);
  }

  @Patch('events/:eventId/volunteers/:id/withdraw')
  @ApiOperation({ summary: 'Withdraw my application before the event starts' })
  withdraw(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.volunteers.withdraw(eventId, id, userId);
  }

  @Patch('events/:eventId/volunteers/:id/check-in')
  @ApiOperation({
    summary: 'Confirm an accepted volunteer’s attendance during the event',
  })
  checkIn(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.volunteers.checkIn(eventId, id, userId);
  }

  @Patch('events/:eventId/volunteers/:id/complete')
  @ApiOperation({
    summary:
      'Confirm a checked-in volunteer’s actual contribution after the event',
  })
  complete(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CompleteVolunteerDto,
  ) {
    return this.volunteers.complete(eventId, id, userId, dto);
  }
}
