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
  ) {
    return this.transactionReferenceService.initiate(userId, email, dto);
  }

  @Post('initiateReg')
  @ApiOperation({ summary: 'Initiate ticket purchase transaction' })
  async initiateRegTransaction(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
    @Query('eventid') reference: string,
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
    @Headers('x-ops-key') opsKey: string,
    @Req() req: any,
    @Body() body: any,
  ) {
    return this.transactionReferenceService.verifyAlatTransfer(
      body,
      signature,
      req?.rawBody,
      opsKey,
    );
  }

  @Get('internal/risk-queue')
  @Public()
  @ApiOperation({ summary: 'Internal risk review queue endpoint' })
  async getRiskReviewQueue(
    @Headers('x-ops-key') opsKey: string,
    @Query() dto: RiskReviewQueueQueryDto,
  ) {
    return {
      data: await this.transactionReferenceService.getRiskReviewQueue(dto, opsKey),
    };
  }

  @Post('internal/:id/risk-review')
  @Public()
  @ApiOperation({ summary: 'Internal transaction risk review endpoint' })
  @ApiParam({ name: 'id', description: 'Transaction reference ID' })
  async reviewTransactionRisk(
    @Param('id') id: string,
    @Headers('x-ops-key') opsKey: string,
    @Body() dto: ReviewTransactionRiskDto,
  ) {
    return this.transactionReferenceService.reviewTransactionRisk(
      id,
      dto,
      opsKey,
    );
  }

  @Get('status/:id')
  @ApiOperation({ summary: 'Get transaction status by ID' })
  @ApiParam({ name: 'id', description: 'Transaction Reference ID' })
  @ApiResponse({
    status: 200,
    description: 'Transaction status returned successfully',
  })
  async getTransactionStatus(@Param('id') id: string) {
    return this.transactionReferenceService.getTransactionStatus(id);
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
  ) {
    return this.transactionReferenceService.getTicketOrRegistrationByTrasactionId(
      id,
      type,
    );
  }
}
