// import {
//     Controller,
//     Get,
//     Post,
//     Body,
//     Param,
//     Query,
//     UseGuards,
//     ValidationPipe,
//     Delete,
//     Patch,
//   } from '@nestjs/common';
//   import {
//     ApiBearerAuth,
//     ApiOperation,
//     ApiResponse,
//     ApiTags,
//     ApiQuery,
//     ApiParam,
//   } from '@nestjs/swagger';
//   import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
//   import { CurrentUser } from 'src/common/decorators/current-user.decorator';
//   import { WalletService } from '../services/wallet.service';
//   import {
//     WalletResponseDto,
//     WithdrawalRequestDto,
//     WalletBalanceDto,
//   } from '../dto/wallet.dto';

//   @ApiTags('Wallet')
//   @Controller('wallet')
//   @UseGuards(JwtAuthGuard)
//   @ApiBearerAuth()
//   export class WalletController {
//     constructor(private readonly walletService: WalletService) {}

//     @Get()
//     @ApiOperation({ summary: 'Get wallet overview with balance, transactions, and payment methods' })
//     @ApiResponse({
//       status: 200,
//       description: 'Returns wallet data',
//       type: WalletResponseDto,
//     })
//     async getWallet(@CurrentUser('id') userId: string) {
//       const data = await this.walletService.getWalletData(userId);

//       return {
//         success: true,
//         message: 'Wallet data retrieved successfully',
//         ...data,
//       };
//     }

//     @Get('balance')
//     @ApiOperation({ summary: 'Get wallet balance only' })
//     @ApiResponse({
//       status: 200,
//       description: 'Returns wallet balance',
//       type: WalletBalanceDto,
//     })
//     async getBalance(@CurrentUser('id') userId: string) {
//       const data = await this.walletService.getWalletData(userId);

//       return {
//         success: true,
//         message: 'Balance retrieved successfully',
//         data: data.balance,
//       };
//     }

//     @Get('transactions')
//     @ApiOperation({ summary: 'Get transaction history with pagination and filters' })
//     @ApiQuery({
//       name: 'page',
//       required: false,
//       type: Number,
//       description: 'Page number (default: 1)',
//     })
//     @ApiQuery({
//       name: 'limit',
//       required: false,
//       type: Number,
//       description: 'Items per page (default: 20)',
//     })
//     @ApiQuery({
//       name: 'type',
//       required: false,
//       enum: ['credit', 'debit'],
//       description: 'Filter by transaction type',
//     })
//     @ApiQuery({
//       name: 'status',
//       required: false,
//       enum: ['completed', 'pending', 'failed'],
//       description: 'Filter by transaction status',
//     })
//     @ApiQuery({
//       name: 'startDate',
//       required: false,
//       type: String,
//       description: 'Start date for filtering (YYYY-MM-DD)',
//     })
//     @ApiQuery({
//       name: 'endDate',
//       required: false,
//       type: String,
//       description: 'End date for filtering (YYYY-MM-DD)',
//     })
//     async getTransactions(
//       @CurrentUser('id') userId: string,
//       @Query('page') page?: number,
//       @Query('limit') limit?: number,
//       @Query('type') type?: string,
//       @Query('status') status?: string,
//       @Query('startDate') startDate?: string,
//       @Query('endDate') endDate?: string,
//     ) {
//       const result = await this.walletService.getTransactionHistory(
//         userId,
//         page || 1,
//         limit || 20,
//         { type, status, startDate, endDate }
//       );

//       return {
//         success: true,
//         message: 'Transactions retrieved successfully',
//         ...result,
//       };
//     }

//     @Post('withdraw')
//     @ApiOperation({ summary: 'Request withdrawal from wallet' })
//     @ApiResponse({
//       status: 200,
//       description: 'Withdrawal request submitted',
//     })
//     async requestWithdrawal(
//       @CurrentUser('id') userId: string,
//       @Body(new ValidationPipe()) dto: WithdrawalRequestDto,
//     ) {
//       return this.walletService.requestWithdrawal(userId, dto);
//     }

//     @Get('withdrawals')
//     @ApiOperation({ summary: 'Get withdrawal history' })
//     @ApiQuery({
//       name: 'page',
//       required: false,
//       type: Number,
//       description: 'Page number (default: 1)',
//     })
//     @ApiQuery({
//       name: 'limit',
//       required: false,
//       type: Number,
//       description: 'Items per page (default: 10)',
//     })
//     async getWithdrawalHistory(
//       @CurrentUser('id') userId: string,
//       @Query('page') page?: number,
//       @Query('limit') limit?: number,
//     ) {
//       const result = await this.walletService.getWithdrawalHistory(
//         userId,
//         page || 1,
//         limit || 10,
//       );

//       return {
//         success: true,
//         message: 'Withdrawal history retrieved successfully',
//         ...result,
//       };
//     }

//     @Post('payment-methods')
//     @ApiOperation({ summary: 'Add a new payment method' })
//     async addPaymentMethod(
//       @CurrentUser('id') userId: string,
//       @Body() data: any,
//     ) {
//       return this.walletService.addPaymentMethod(userId, data);
//     }

//     @Patch('payment-methods/:id/default')
//     @ApiOperation({ summary: 'Set payment method as default' })
//     @ApiParam({
//       name: 'id',
//       description: 'Payment method ID',
//       type: String,
//     })
//     async setDefaultPaymentMethod(
//       @CurrentUser('id') userId: string,
//       @Param('id') methodId: string,
//     ) {
//       return this.walletService.setDefaultPaymentMethod(userId, methodId);
//     }

//     @Delete('payment-methods/:id')
//     @ApiOperation({ summary: 'Remove a payment method' })
//     @ApiParam({
//       name: 'id',
//       description: 'Payment method ID',
//       type: String,
//     })
//     async removePaymentMethod(
//       @CurrentUser('id') userId: string,
//       @Param('id') methodId: string,
//     ) {
//       return this.walletService.removePaymentMethod(userId, methodId);
//     }

//     @Get('stats')
//     @ApiOperation({ summary: 'Get wallet statistics' })
//     async getWalletStats(@CurrentUser('id') userId: string) {
//       // Get wallet data
//       const walletData = await this.walletService.getWalletData(userId);

//       // Calculate monthly stats
//       const now = new Date();
//       const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

//       const monthlyTransactions = await this.walletService.getTransactionHistory(
//         userId,
//         1,
//         100, // Get all transactions for the month
//         { startDate: startOfMonth.toISOString().split('T')[0] }
//       );

//       const monthlyIncome = monthlyTransactions.transactions
//         .filter(t => t.type === 'credit' && t.status === 'completed')
//         .reduce((sum, t) => sum + t.amount, 0);

//       const monthlyExpense = monthlyTransactions.transactions
//         .filter(t => t.type === 'debit' && t.status === 'completed')
//         .reduce((sum, t) => sum + t.amount, 0);

//       // Count transactions by event
//       const eventStats: Record<string, number> = {};
//       monthlyTransactions.transactions.forEach(t => {
//         if (t.event) {
//           eventStats[t.event] = (eventStats[t.event] || 0) + t.amount;
//         }
//       });

//       // Get top 3 events
//       const topEvents = Object.entries(eventStats)
//         .sort(([,a], [,b]) => b - a)
//         .slice(0, 3)
//         .map(([event, amount]) => ({ event, amount }));

//       return {
//         success: true,
//         message: 'Wallet statistics retrieved successfully',
//         data: {
//           balance: walletData.balance,
//           monthly: {
//             income: monthlyIncome,
//             expense: monthlyExpense,
//             net: monthlyIncome - monthlyExpense,
//           },
//           topEvents,
//           transactionCount: monthlyTransactions.transactions.length,
//           paymentMethodCount: walletData.paymentMethods.length,
//         },
//       };
//     }
//   }
