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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import {
  AccountChangesQueryDto,
  CompleteSettlementDto,
  CreateSettlementDto,
  InternalAlatQueueQueryDto,
  InternalKycQueueQueryDto,
    PersonalLivenessDto,
    NotifyOnKycResolutionDto,
    ReviewKycDto,
    ReviewPayoutProfileDto,
    StartBusinessKycDto,
    StartBusinessRepresentativeKycDto,
    StartPersonalKycDto,
  SubmitKycDto,
  UpsertAlatProfileDto,
  UpsertPayoutProfileDto,
  WalletSettlementsQueryDto,
  WalletTransactionsQueryDto,
} from '../dto/wallet.dto';
import { WalletService } from '../service/wallet.service';

@ApiTags('Wallet')
@Controller('wallet')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get creator wallet overview' })
  async getWalletOverview(@CurrentUser('id') userId: string) {
    return this.walletService.getWalletOverview(userId);
  }

  @Get('payout-profile')
  @ApiOperation({ summary: 'Get creator payout profile' })
  async getPayoutProfile(@CurrentUser('id') userId: string) {
    return this.walletService.getPayoutProfile(userId);
  }

  @Get('onboarding')
  @ApiOperation({ summary: 'Get creator onboarding checklist state' })
  async getOnboarding(@CurrentUser('id') userId: string) {
    return this.walletService.getOnboarding(userId);
  }

  @Get('kyc')
  @ApiOperation({ summary: 'Get creator KYC state' })
  async getKyc(@CurrentUser('id') userId: string) {
    return this.walletService.getKyc(userId);
  }

  @Get('account-changes')
  @ApiOperation({ summary: 'List settlement account change history' })
  async getAccountChanges(
    @CurrentUser('id') userId: string,
    @Query() dto: AccountChangesQueryDto,
  ) {
    return this.walletService.getAccountChanges(userId, dto);
  }

  @Get('banks')
  @ApiOperation({ summary: 'Get available payout banks from QoreID' })
  async getBanks() {
    return this.walletService.getBanks();
  }

  @Get('alat-profile')
  @ApiOperation({ summary: 'Get creator ALAT transfer profile' })
  async getAlatProfile(@CurrentUser('id') userId: string) {
    return this.walletService.getAlatProfile(userId);
  }

  @Post('payout-profile')
  @ApiOperation({ summary: 'Create or update creator payout profile' })
  async upsertPayoutProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertPayoutProfileDto,
  ) {
    return this.walletService.upsertPayoutProfile(userId, dto);
  }

  @Post('kyc/personal/start')
  @ApiOperation({ summary: 'Start or update personal KYC draft' })
  async startPersonalKyc(
    @CurrentUser('id') userId: string,
    @Body() dto: StartPersonalKycDto,
  ) {
    return this.walletService.startPersonalKyc(userId, dto);
  }

  @Post('kyc/personal/liveness')
  @ApiOperation({ summary: 'Save personal KYC liveness submission' })
  async submitPersonalLiveness(
    @CurrentUser('id') userId: string,
    @Body() dto: PersonalLivenessDto,
  ) {
    return this.walletService.submitPersonalLiveness(userId, dto);
  }

  @Post('kyc/business/start')
  @ApiOperation({ summary: 'Start or update business CAC verification draft' })
  async startBusinessKyc(
    @CurrentUser('id') userId: string,
    @Body() dto: StartBusinessKycDto,
  ) {
    return this.walletService.startBusinessKyc(userId, dto);
  }

  @Post('kyc/business/representative')
  @ApiOperation({ summary: 'Start or update business representative KYC draft' })
  async startBusinessRepresentativeKyc(
    @CurrentUser('id') userId: string,
    @Body() dto: StartBusinessRepresentativeKycDto,
  ) {
    return this.walletService.startBusinessRepresentativeKyc(userId, dto);
  }

  @Post('kyc/submit')
  @ApiOperation({ summary: 'Submit KYC for review' })
  async submitKyc(
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitKycDto,
  ) {
    return this.walletService.submitKyc(userId, dto);
  }

  @Post('kyc/notify-on-resolution')
  @ApiOperation({ summary: 'Notify creator when a pending provider verification resolves' })
  async notifyOnKycResolution(
    @CurrentUser('id') userId: string,
    @Body() dto: NotifyOnKycResolutionDto,
  ) {
    return this.walletService.notifyOnKycResolution(userId, dto);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List creator wallet transactions' })
  async getTransactions(
    @CurrentUser('id') userId: string,
    @Query() dto: WalletTransactionsQueryDto,
  ) {
    return this.walletService.getTransactionHistory(userId, dto);
  }

  @Get('settlements')
  @ApiOperation({ summary: 'List creator settlements' })
  async getSettlements(
    @CurrentUser('id') userId: string,
    @Query() dto: WalletSettlementsQueryDto,
  ) {
    return this.walletService.getSettlementHistory(userId, dto);
  }

  @Post('internal/payout-profile/:userId/review')
  @Public()
  @ApiOperation({ summary: 'Internal payout-profile review endpoint' })
  @ApiParam({ name: 'userId', description: 'Creator user ID' })
  async reviewPayoutProfile(
    @Param('userId') userId: string,
    @Headers('x-ops-key') opsKey: string,
    @Body() dto: ReviewPayoutProfileDto,
  ) {
    return this.walletService.reviewPayoutProfile(userId, dto, opsKey);
  }

  @Get('internal/kyc-queue')
  @Public()
  @ApiOperation({ summary: 'Internal KYC review queue endpoint' })
  async getInternalKycQueue(
    @Headers('x-ops-key') opsKey: string,
    @Query() dto: InternalKycQueueQueryDto,
  ) {
    return {
      data: await this.walletService.getInternalKycQueue(dto, opsKey),
    };
  }

  @Get('internal/alat-queue')
  @Public()
  @ApiOperation({ summary: 'Internal ALAT setup queue endpoint' })
  async getInternalAlatQueue(
    @Headers('x-ops-key') opsKey: string,
    @Query() dto: InternalAlatQueueQueryDto,
  ) {
    return {
      data: await this.walletService.getInternalAlatQueue(dto, opsKey),
    };
  }

  @Post('internal/kyc/:userId/review')
  @Public()
  @ApiOperation({ summary: 'Internal KYC review endpoint' })
  @ApiParam({ name: 'userId', description: 'Creator user ID' })
  async reviewKyc(
    @Param('userId') userId: string,
    @Headers('x-ops-key') opsKey: string,
    @Body() dto: ReviewKycDto,
  ) {
    return this.walletService.reviewKyc(userId, dto, opsKey);
  }

  @Post('webhooks/qoreid')
  @Public()
  @ApiOperation({ summary: 'Receive QoreID webhook callbacks' })
  async handleQoreIdWebhook(
    @Headers('x-verifyme-signature') signature: string,
    @Req() req: any,
    @Body() body: any,
  ) {
    return this.walletService.handleQoreIdWebhook(body, signature, req?.rawBody);
  }

  @Post('internal/alat-profile/:userId')
  @Public()
  @ApiOperation({ summary: 'Internal ALAT profile upsert endpoint' })
  @ApiParam({ name: 'userId', description: 'Creator user ID' })
  async upsertAlatProfile(
    @Param('userId') userId: string,
    @Headers('x-ops-key') opsKey: string,
    @Body() dto: UpsertAlatProfileDto,
  ) {
    return this.walletService.upsertAlatProfile(userId, dto, opsKey);
  }

  @Post('internal/settlements/:creatorId')
  @Public()
  @ApiOperation({ summary: 'Internal settlement creation endpoint' })
  @ApiParam({ name: 'creatorId', description: 'Creator user ID' })
  async createSettlement(
    @Param('creatorId') creatorId: string,
    @Headers('x-ops-key') opsKey: string,
    @Body() dto: CreateSettlementDto,
  ) {
    return this.walletService.createSettlement(creatorId, dto, opsKey);
  }

  @Post('internal/settlements/:settlementId/complete')
  @Public()
  @ApiOperation({ summary: 'Internal settlement completion endpoint' })
  @ApiParam({ name: 'settlementId', description: 'Settlement record ID' })
  async completeSettlement(
    @Param('settlementId') settlementId: string,
    @Headers('x-ops-key') opsKey: string,
    @Body() dto: CompleteSettlementDto,
  ) {
    return this.walletService.completeSettlement(settlementId, dto, opsKey);
  }
}
