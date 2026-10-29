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
  InternalSettlementQueueQueryDto,
  InternalSettlementsQueryDto,
  PersonalLivenessDto,
  NotifyOnKycResolutionDto,
  ReviewKycDto,
  ReviewPayoutProfileDto,
  ResolvePayoutAccountDto,
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
  @ApiOperation({
    summary: 'Get available Nigerian payout banks from Paystack',
  })
  async getBanks() {
    return this.walletService.getBanks();
  }

  @Get('payout-profile/resolve-account')
  @ApiOperation({ summary: 'Resolve payout account name with Paystack' })
  async resolvePayoutAccount(
    @CurrentUser('id') userId: string,
    @Query() dto: ResolvePayoutAccountDto,
  ) {
    return this.walletService.resolvePayoutAccount(userId, dto);
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

  @Post('payout-profile/confirm')
  @ApiOperation({ summary: 'Confirm resolved payout account name' })
  async confirmPayoutProfile(@CurrentUser('id') userId: string) {
    return this.walletService.confirmPayoutProfile(userId);
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
  @ApiOperation({
    summary: 'Start or update business representative KYC draft',
  })
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
  @ApiOperation({
    summary: 'Notify creator when a pending provider verification resolves',
  })
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
  @DashboardAccess('admin')
  @ApiOperation({ summary: 'Internal payout-profile review endpoint' })
  @ApiParam({ name: 'userId', description: 'Creator user ID' })
  async reviewPayoutProfile(
    @Param('userId') userId: string,
    @CurrentDashboard() session: DashboardSessionContext,
    @Body() dto: ReviewPayoutProfileDto,
  ) {
    return this.walletService.reviewPayoutProfile(userId, dto, session.user);
  }

  @Get('internal/kyc-queue')
  @DashboardAccess('read')
  @ApiOperation({ summary: 'Internal KYC review queue endpoint' })
  async getInternalKycQueue(
    @CurrentDashboard() session: DashboardSessionContext,
    @Query() dto: InternalKycQueueQueryDto,
  ) {
    return {
      data: await this.walletService.getInternalKycQueue(dto, session.user),
    };
  }

  @Get('internal/alat-queue')
  @DashboardAccess('read')
  @ApiOperation({ summary: 'Internal ALAT setup queue endpoint' })
  async getInternalAlatQueue(
    @CurrentDashboard() session: DashboardSessionContext,
    @Query() dto: InternalAlatQueueQueryDto,
  ) {
    return {
      data: await this.walletService.getInternalAlatQueue(dto, session.user),
    };
  }

  @Post('internal/kyc/:userId/review')
  @DashboardAccess('admin')
  @ApiOperation({ summary: 'Internal KYC review endpoint' })
  @ApiParam({ name: 'userId', description: 'Creator user ID' })
  async reviewKyc(
    @Param('userId') userId: string,
    @CurrentDashboard() session: DashboardSessionContext,
    @Body() dto: ReviewKycDto,
  ) {
    return this.walletService.reviewKyc(userId, dto, session.user);
  }

  @Post('webhooks/dikript')
  @Public()
  @ApiOperation({ summary: 'Receive Dikript webhook callbacks' })
  async handleDikriptWebhook(
    @Headers('x-dikript-signature') dikriptSignature: string,
    @Headers('x-verifide-signature') verifideSignature: string,
    @Req() req: { rawBody?: Buffer },
    @Body() body: any,
  ) {
    return this.walletService.handleDikriptWebhook(
      body,
      dikriptSignature || verifideSignature,
      req?.rawBody,
    );
  }

  @Post('webhooks/qoreid')
  @Public()
  @ApiOperation({ summary: 'Legacy KYC webhook callback alias' })
  async handleLegacyKycWebhook(
    @Headers('x-verifyme-signature') signature: string,
    @Req() req: { rawBody?: Buffer },
    @Body() body: any,
  ) {
    return this.walletService.handleDikriptWebhook(
      body,
      signature,
      req?.rawBody,
    );
  }

  @Post('internal/alat-profile/:userId')
  @DashboardAccess('admin')
  @ApiOperation({ summary: 'Internal ALAT profile upsert endpoint' })
  @ApiParam({ name: 'userId', description: 'Creator user ID' })
  async upsertAlatProfile(
    @Param('userId') userId: string,
    @CurrentDashboard() session: DashboardSessionContext,
    @Body() dto: UpsertAlatProfileDto,
  ) {
    return this.walletService.upsertAlatProfile(userId, dto, session.user);
  }

  @Get('internal/settlement-queue')
  @DashboardAccess('read')
  @ApiOperation({ summary: 'List calculated creator settlement balances' })
  async getInternalSettlementQueue(
    @CurrentDashboard() session: DashboardSessionContext,
    @Query() dto: InternalSettlementQueueQueryDto,
  ) {
    return {
      data: await this.walletService.getInternalSettlementQueue(
        dto,
        session.user,
      ),
    };
  }

  @Get('internal/settlements')
  @DashboardAccess('read')
  @ApiOperation({ summary: 'List platform settlement records' })
  async getInternalSettlements(
    @CurrentDashboard() session: DashboardSessionContext,
    @Query() dto: InternalSettlementsQueryDto,
  ) {
    return this.walletService.getInternalSettlements(dto, session.user);
  }

  @Get('internal/settlements/:creatorId/preview')
  @DashboardAccess('read')
  @ApiOperation({
    summary: 'Calculate currently eligible payments and net creator settlement',
  })
  async previewSettlement(
    @Param('creatorId') creatorId: string,
    @CurrentDashboard() session: DashboardSessionContext,
  ) {
    return this.walletService.previewSettlement(creatorId, session.user);
  }

  @Post('internal/settlements/:creatorId')
  @DashboardAccess('admin')
  @ApiOperation({ summary: 'Internal settlement creation endpoint' })
  @ApiParam({ name: 'creatorId', description: 'Creator user ID' })
  async createSettlement(
    @Param('creatorId') creatorId: string,
    @CurrentDashboard() session: DashboardSessionContext,
    @Body() dto: CreateSettlementDto,
  ) {
    return this.walletService.createSettlement(creatorId, dto, session.user);
  }

  @Post('internal/settlements/:settlementId/complete')
  @DashboardAccess('admin')
  @ApiOperation({ summary: 'Internal settlement completion endpoint' })
  @ApiParam({ name: 'settlementId', description: 'Settlement record ID' })
  async completeSettlement(
    @Param('settlementId') settlementId: string,
    @CurrentDashboard() session: DashboardSessionContext,
    @Body() dto: CompleteSettlementDto,
  ) {
    return this.walletService.completeSettlement(
      settlementId,
      dto,
      session.user,
    );
  }
}
