import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { RateLimit } from 'src/common/decorators/rate-limit.decorator';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';
import { CreateTransactionReferenceDto } from '../transaction-reference/dto/create-transaction-reference.dto';
import { InitiateDonationDto } from '../transaction-reference/dto/initiate-donation.dto';
import { PublicWebService } from './public-web.service';
import { WebSessionService } from './web-session.service';
import { CurrentWebSession, WebSessionGuard } from './web-session.guard';
import type { WebSessionContext } from './web-session.guard';
import {
  WebEmailDto,
  WebVerifyEmailDto,
  WebVolunteerDto,
} from './public-web.dto';

@ApiTags('Public web')
@Public()
@Controller('public')
@UseGuards(RateLimitGuard)
@RateLimit({ windowSec: 60, max: 120, cooldownSec: 60 })
export class PublicWebController {
  constructor(
    private readonly web: PublicWebService,
    private readonly sessions: WebSessionService,
  ) {}

  @Get('config') config() {
    return this.web.config();
  }
  @Get('events/:id') event(@Param('id') id: string) {
    return this.web.event(id);
  }
  @Get('carpools/:id') carpool(@Param('id') id: string) {
    return this.web.carpool(id);
  }

  @Post('email/code')
  @RateLimit({ windowSec: 600, max: 5, cooldownSec: 600 })
  requestCode(@Body() dto: WebEmailDto) {
    return this.sessions.requestCode(dto.email);
  }

  @Post('email/verify')
  @RateLimit({ windowSec: 600, max: 15, cooldownSec: 600 })
  verifyCode(@Body() dto: WebVerifyEmailDto) {
    return this.sessions.verifyCode(dto);
  }

  @Get('session')
  @UseGuards(WebSessionGuard)
  session(@CurrentWebSession() session: WebSessionContext) {
    return {
      email: session.user.email,
      fullName: session.user.fullName,
      existingAccount: !session.user.isGuest,
      expiresAt: session.expiresAt,
    };
  }

  @Post('session/end')
  @UseGuards(WebSessionGuard)
  logout(@CurrentWebSession() session: WebSessionContext) {
    return this.sessions.revoke(session.id);
  }

  @Post('tickets')
  @UseGuards(WebSessionGuard)
  tickets(
    @CurrentWebSession() session: WebSessionContext,
    @Body() dto: CreateTransactionReferenceDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.web.tickets(session, dto, key);
  }

  @Post('events/:id/registration')
  @UseGuards(WebSessionGuard)
  registration(
    @CurrentWebSession() session: WebSessionContext,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
  ) {
    return this.web.registration(session, id, key);
  }

  @Post('donations')
  @UseGuards(WebSessionGuard)
  donation(
    @CurrentWebSession() session: WebSessionContext,
    @Body() dto: InitiateDonationDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.web.donation(session, dto, key);
  }

  @Post('events/:id/volunteer-roles/:roleId/apply')
  @UseGuards(WebSessionGuard)
  volunteer(
    @CurrentWebSession() session: WebSessionContext,
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @Body() dto: WebVolunteerDto,
  ) {
    return this.web.volunteer(session, id, roleId, dto);
  }

  @Get('checkouts/:id')
  @UseGuards(WebSessionGuard)
  receipt(
    @CurrentWebSession() session: WebSessionContext,
    @Param('id') id: string,
  ) {
    return this.web.receipt(session, id);
  }

  @Post('checkouts/:id/cancel')
  @UseGuards(WebSessionGuard)
  cancel(
    @CurrentWebSession() session: WebSessionContext,
    @Param('id') id: string,
  ) {
    return this.web.cancel(session, id);
  }
}
