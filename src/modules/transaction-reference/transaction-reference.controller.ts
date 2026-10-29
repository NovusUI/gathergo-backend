import {
  CurrentDashboard,
  DashboardAccess,
} from 'src/modules/dashboard-auth/dashboard-access';
import type { DashboardSessionContext } from 'src/modules/dashboard-auth/dashboard-auth.types';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TransactionReferenceService } from './transaction-reference.service';
import { CreateTransactionReferenceDto } from './dto/create-transaction-reference.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { InitiateDonationDto } from './dto/initiate-donation.dto';
import { Public } from 'src/common/decorators/public.decorator';
import { RateLimit } from 'src/common/decorators/rate-limit.decorator';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';
import {
  PaymentClientContextDto,
  PaymentProviderDto,
} from './dto/payment-provider.dto';
import { RiskReviewQueueQueryDto } from './dto/risk-review-queue.dto';
import { ReviewTransactionRiskDto } from './dto/review-transaction-risk.dto';
import { BatchReviewTransactionRiskDto } from './dto/batch-review-transaction-risk.dto';

@Controller('transaction-reference')
@ApiTags('Transaction References')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class TransactionReferenceController {
  constructor(
    private readonly transactionReferenceService: TransactionReferenceService,
  ) {}

  @Post('initiate')
  @ApiOperation({ summary: 'Initiate ticket purchase transaction' })
  async initiateTransaction(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
    @Body() dto: CreateTransactionReferenceDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.transactionReferenceService.initiate(
      userId,
      email,
      dto,
      idempotencyKey,
    );
  }

  @Post('initiateReg')
  @ApiOperation({ summary: 'Initiate ticket purchase transaction' })
  async initiateRegTransaction(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
    @Query('eventid') reference: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Query('beneficiaryType') beneficiaryType?: string,
    @Query('sponsorshipNote') sponsorshipNote?: string,
    @Query('provider') provider?: PaymentProviderDto,
    @Query('deviceId') deviceId?: string,
    @Query('platform') platform?: string,
  ) {
    return this.transactionReferenceService.initiateRegistration(
      userId,
      email,
      reference,
      idempotencyKey,
      {
        beneficiaryType,
        sponsorshipNote,
        provider,
        clientContext: {
          deviceId,
          platform,
        } as PaymentClientContextDto,
      },
    );
  }

  @Post('initiateDonation')
  @ApiOperation({ summary: 'Initiate donation transaction' })
  async initiateDonationTransaction(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
    @Body() dto: InitiateDonationDto,
  ) {
    return this.transactionReferenceService.initiateDonation(
      userId,
      email,
      dto,
    );
  }

  @Post('verify')
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ windowSec: 60, max: 120, cooldownSec: 60 })
  @ApiOperation({ summary: 'Verify transaction after Paystack callback' })
  async verifyTransaction(
    @Headers('x-paystack-signature') signature: string,
    @Req() req: any,
    @Body() body: any,
  ) {
    return this.transactionReferenceService.verifyPayment(
      body,
      signature,
      req?.rawBody,
    );
  }

  @Post('verify/alat')
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ windowSec: 60, max: 120, cooldownSec: 60 })
  @ApiOperation({ summary: 'Verify ALAT transfer collection' })
  async verifyAlatTransaction(
    @Headers('x-alat-signature') signature: string,
    @Req() req: any,
    @Body() body: any,
  ) {
    return this.transactionReferenceService.verifyAlatTransfer(
      body,
      signature,
      req?.rawBody,
    );
  }

  @Get('internal/risk-queue')
  @DashboardAccess('read')
  @ApiOperation({ summary: 'Internal risk review queue endpoint' })
  async getRiskReviewQueue(
    @CurrentDashboard() session: DashboardSessionContext,
    @Query() dto: RiskReviewQueueQueryDto,
  ) {
    return {
      data: await this.transactionReferenceService.getRiskReviewQueue(
        dto,
        session.user,
      ),
    };
  }

  @Post('internal/risk-reviews')
  @DashboardAccess('admin')
  @ApiOperation({
    summary: 'Review up to 50 selected payments, reporting each outcome',
  })
  async reviewTransactionRiskBatch(
    @CurrentDashboard() session: DashboardSessionContext,
    @Body() dto: BatchReviewTransactionRiskDto,
  ) {
    return this.transactionReferenceService.reviewTransactionRiskBatch(
      dto,
      session.user,
    );
  }

  @Post('internal/:id/risk-review')
  @DashboardAccess('admin')
  @ApiOperation({ summary: 'Internal transaction risk review endpoint' })
  @ApiParam({ name: 'id', description: 'Transaction reference ID' })
  async reviewTransactionRisk(
    @Param('id') id: string,
    @CurrentDashboard() session: DashboardSessionContext,
    @Body() dto: ReviewTransactionRiskDto,
  ) {
    return this.transactionReferenceService.reviewTransactionRisk(
      id,
      dto,
      session.user,
    );
  }

  @Post(':id/cancel')
  cancelCheckout(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.transactionReferenceService.cancelCheckout(id, userId);
  }

  @Get('internal/refunds')
  @DashboardAccess('read')
  refundQueue(@CurrentDashboard() session: DashboardSessionContext) {
    return this.transactionReferenceService.refundQueue(session.user);
  }

  @Post('internal/:id/refund-confirmation')
  @DashboardAccess('admin')
  confirmRefund(
    @Param('id') id: string,
    @CurrentDashboard() session: DashboardSessionContext,
    @Body('reference') reference: string,
  ) {
    return this.transactionReferenceService.confirmManualRefund(
      id,
      reference,
      session.user,
    );
  }

  @Get('status/:id')
  @ApiOperation({ summary: 'Get transaction status by ID' })
  @ApiParam({ name: 'id', description: 'Transaction Reference ID' })
  @ApiResponse({
    status: 200,
    description: 'Transaction status returned successfully',
  })
  async getTransactionStatus(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.transactionReferenceService.getTransactionStatus(id, userId);
  }

  @Get('ticketorreg/:id')
  @ApiOperation({ summary: 'Get transaction status by ID' })
  @ApiParam({ name: 'id', description: 'Transaction Reference ID' })
  @ApiResponse({
    status: 200,
    description: 'Transaction status returned successfully',
  })
  async getTicketOrRegByTreansactionId(
    @Param('id') id: string,
    @Query('type') type: 'REGISTRATION' | 'TICKET',
    @CurrentUser('id') userId: string,
  ) {
    return this.transactionReferenceService.getTicketOrRegistrationByTrasactionId(
      id,
      type,
      userId,
    );
  }
}
