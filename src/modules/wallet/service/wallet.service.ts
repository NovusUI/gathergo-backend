// import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
// import { PrismaService } from 'src/prisma/prisma.service';
// import { WithdrawalRequestDto } from '../dto/wallet.dto';

// @Injectable()
// export class WalletService {
//   constructor(private prisma: PrismaService) {}

//   async getWalletData(userId: string) {
//     // Get user's wallet
//     const wallet = await this.prisma.wallet.findUnique({
//       where: { userId },
//     });

//     if (!wallet) {
//       throw new NotFoundException('Wallet not found');
//     }

//     // Get recent transactions
//     const transactions = await this.getRecentTransactions(userId);

//     // Get payment methods
//     const paymentMethods = await this.getPaymentMethods(userId);

//     // Format the response
//     return {
//       balance: {
//         availableBalance: wallet.balance,
//         pendingBalance: wallet.pendingBalance || 0,
//         totalBalance: (wallet.balance + (wallet.pendingBalance || 0)),
//         currency: wallet.currency || 'NGN',
//       },
//       transactions: transactions.map(txn => this.formatTransaction(txn)),
//       paymentMethods: paymentMethods.map(pm => this.formatPaymentMethod(pm)),
//     };
//   }

//   private async getRecentTransactions(userId: string, limit: number = 10) {
//     // Get transactions where user is sender or receiver
//     return this.prisma.transactionReference.findMany({
//       where: {
//         userId,
//         status: { in: ['SUCCESS', 'PENDING', 'FAILED'] },
//       },
//       include: {
//         event: {
//           select: {
//             title: true,
//           },
//         },
//         user: {
//           select: {
//             name: true,
//           },
//         },
//       },
//       orderBy: { createdAt: 'desc' },
//       take: limit,
//     });
//   }

//   private async getPaymentMethods(userId: string) {
//     return this.prisma.paymentMethod.findMany({
//       where: {
//         userId,
//         isActive: true,
//       },
//       orderBy: { isDefault: 'desc' },
//     });
//   }

//   private formatTransaction(transaction: any) {
//     // Determine transaction type and color
//     const isCredit = transaction.amount > 0;
//     const type = isCredit ? 'credit' : 'debit';

//     let color = '#5669FF'; // Default blue
//     if (type === 'credit') {
//       color = '#28A745'; // Green for credits
//     } else if (type === 'debit') {
//       color = '#FF5757'; // Red for debits
//     }

//     // Determine status
//     let status: 'completed' | 'pending' | 'failed' = 'pending';
//     if (transaction.status === 'SUCCESS') status = 'completed';
//     else if (transaction.status === 'FAILED') status = 'failed';

//     return {
//       id: transaction.id,
//       description: this.getTransactionDescription(transaction),
//       amount: Math.abs(transaction.amount / 100), // Convert from kobo
//       type,
//       status,
//       counterparty: transaction.user?.name || 'Anonymous',
//       date: transaction.createdAt.toISOString(),
//       event: transaction.event?.title,
//       color,
//     };
//   }

//   private getTransactionDescription(transaction: any): string {
//     const metadata = transaction.metadata || {};

//     if (metadata.description) {
//       return metadata.description;
//     }

//     if (transaction.event) {
//       return `Payment for ${transaction.event.title}`;
//     }

//     return transaction.amount > 0 ? 'Credit' : 'Debit';
//   }

//   private formatPaymentMethod(paymentMethod: any) {
//     let color = '#FF932E'; // Default orange
//     let provider = 'Unknown';
//     let displayNumber = '';

//     switch (paymentMethod.type) {
//       case 'bank':
//         color = '#5669FF'; // Blue
//         provider = paymentMethod.bankName || 'Bank';
//         displayNumber = `••••${paymentMethod.accountNumber.slice(-4)}`;
//         break;
//       case 'card':
//         color = '#9D4EDD'; // Purple
//         provider = paymentMethod.cardBrand || 'Card';
//         displayNumber = `•••• ${paymentMethod.last4}`;
//         break;
//       case 'mobile_money':
//         color = '#28A745'; // Green
//         provider = paymentMethod.provider || 'Mobile Money';
//         displayNumber = paymentMethod.phoneNumber;
//         break;
//     }

//     return {
//       id: paymentMethod.id,
//       type: paymentMethod.type,
//       provider,
//       accountNumber: displayNumber,
//       accountName: paymentMethod.accountName || 'N/A',
//       isDefault: paymentMethod.isDefault,
//       color,
//     };
//   }

//   async requestWithdrawal(userId: string, dto: WithdrawalRequestDto) {
//     // Check if wallet exists
//     const wallet = await this.prisma.wallet.findUnique({
//       where: { userId },
//     });

//     if (!wallet) {
//       throw new NotFoundException('Wallet not found');
//     }

//     // Check if sufficient balance
//     const amountInKobo = Math.round(dto.amount * 100); // Convert to kobo
//     if (wallet.balance < amountInKobo) {
//       throw new BadRequestException('Insufficient balance');
//     }

//     // Check if payment method exists and belongs to user
//     const paymentMethod = await this.prisma.paymentMethod.findFirst({
//       where: {
//         id: dto.paymentMethodId,
//         userId,
//         isActive: true,
//       },
//     });

//     if (!paymentMethod) {
//       throw new NotFoundException('Payment method not found');
//     }

//     // Create withdrawal request (in a transaction)
//     const withdrawal = await this.prisma.$transaction(async (tx) => {
//       // Create withdrawal record
//       const withdrawal = await tx.withdrawalRequest.create({
//         data: {
//           userId,
//           amount: amountInKobo,
//           paymentMethodId: dto.paymentMethodId,
//           status: 'PENDING',
//           reference: this.generateReference(),
//         },
//       });

//       // Deduct from available balance and add to pending
//       await tx.wallet.update({
//         where: { userId },
//         data: {
//           balance: wallet.balance - amountInKobo,
//           pendingBalance: (wallet.pendingBalance || 0) + amountInKobo,
//         },
//       });

//       // Create transaction record
//       await tx.transactionReference.create({
//         data: {
//           userId,
//           amount: -amountInKobo, // Negative for withdrawal
//           status: 'PENDING',
//           metadata: {
//             type: 'withdrawal',
//             withdrawalId: withdrawal.id,
//             paymentMethod: paymentMethod.type,
//             description: 'Withdrawal request',
//           },
//         },
//       });

//       return withdrawal;
//     });

//     return {
//       success: true,
//       message: 'Withdrawal request submitted successfully',
//       data: {
//         id: withdrawal.id,
//         amount: dto.amount,
//         status: withdrawal.status,
//         reference: withdrawal.reference,
//         estimatedDelivery: this.getEstimatedDeliveryDate(),
//       },
//     };
//   }

//   private generateReference(): string {
//     return `WDR${Date.now()}${Math.floor(Math.random() * 1000)}`;
//   }

//   private getEstimatedDeliveryDate(): string {
//     const date = new Date();
//     date.setDate(date.getDate() + 2); // 2 business days
//     return date.toISOString();
//   }

//   async getWithdrawalHistory(userId: string, page: number = 1, limit: number = 10) {
//     const skip = (page - 1) * limit;

//     const [withdrawals, total] = await Promise.all([
//       this.prisma.withdrawalRequest.findMany({
//         where: { userId },
//         include: {
//           paymentMethod: true,
//         },
//         orderBy: { createdAt: 'desc' },
//         skip,
//         take: limit,
//       }),
//       this.prisma.withdrawalRequest.count({
//         where: { userId },
//       }),
//     ]);

//     const formattedWithdrawals = withdrawals.map(w => ({
//       id: w.id,
//       amount: w.amount / 100,
//       status: w.status,
//       reference: w.reference,
//       paymentMethod: w.paymentMethod.type,
//       accountNumber: this.maskAccountNumber(w.paymentMethod),
//       createdAt: w.createdAt.toISOString(),
//       completedAt: w.completedAt?.toISOString(),
//     }));

//     return {
//       withdrawals: formattedWithdrawals,
//       pagination: {
//         page,
//         limit,
//         total,
//         totalPages: Math.ceil(total / limit),
//         hasMore: (page * limit) < total,
//       },
//     };
//   }

//   private maskAccountNumber(paymentMethod: any): string {
//     switch (paymentMethod.type) {
//       case 'bank':
//         return `••••${paymentMethod.accountNumber?.slice(-4) || '****'}`;
//       case 'card':
//         return `•••• ${paymentMethod.last4 || '****'}`;
//       case 'mobile_money':
//         return paymentMethod.phoneNumber || 'N/A';
//       default:
//         return '••••••••';
//     }
//   }

//   async addPaymentMethod(userId: string, data: any) {
//     // Check if this is the first payment method (make it default)
//     const existingMethods = await this.prisma.paymentMethod.count({
//       where: { userId, isActive: true },
//     });

//     const isDefault = existingMethods === 0;

//     const paymentMethod = await this.prisma.paymentMethod.create({
//       data: {
//         userId,
//         type: data.type,
//         bankName: data.bankName,
//         accountNumber: data.accountNumber,
//         accountName: data.accountName,
//         cardBrand: data.cardBrand,
//         last4: data.last4,
//         phoneNumber: data.phoneNumber,
//         provider: data.provider,
//         isDefault,
//         isActive: true,
//       },
//     });

//     return {
//       success: true,
//       message: 'Payment method added successfully',
//       data: this.formatPaymentMethod(paymentMethod),
//     };
//   }

//   async setDefaultPaymentMethod(userId: string, methodId: string) {
//     // Reset all to not default
//     await this.prisma.paymentMethod.updateMany({
//       where: { userId, isActive: true },
//       data: { isDefault: false },
//     });

//     // Set new default
//     const updated = await this.prisma.paymentMethod.update({
//       where: {
//         id: methodId,
//         userId,
//       },
//       data: { isDefault: true },
//     });

//     return {
//       success: true,
//       message: 'Default payment method updated',
//       data: this.formatPaymentMethod(updated),
//     };
//   }

//   async removePaymentMethod(userId: string, methodId: string) {
//     const paymentMethod = await this.prisma.paymentMethod.findFirst({
//       where: { id: methodId, userId },
//     });

//     if (!paymentMethod) {
//       throw new NotFoundException('Payment method not found');
//     }

//     // If it's the default, find another to set as default
//     if (paymentMethod.isDefault) {
//       const otherMethod = await this.prisma.paymentMethod.findFirst({
//         where: {
//           userId,
//           id: { not: methodId },
//           isActive: true,
//         },
//       });

//       if (otherMethod) {
//         await this.prisma.paymentMethod.update({
//           where: { id: otherMethod.id },
//           data: { isDefault: true },
//         });
//       }
//     }

//     // Soft delete
//     await this.prisma.paymentMethod.update({
//       where: { id: methodId },
//       data: { isActive: false },
//     });

//     return {
//       success: true,
//       message: 'Payment method removed successfully',
//     };
//   }

//   async getTransactionHistory(
//     userId: string,
//     page: number = 1,
//     limit: number = 20,
//     filters?: { type?: string; status?: string; startDate?: string; endDate?: string }
//   ) {
//     const skip = (page - 1) * limit;

//     const whereClause: any = { userId };

//     if (filters) {
//       if (filters.type) {
//         whereClause.amount = filters.type === 'credit' ? { gt: 0 } : { lt: 0 };
//       }
//       if (filters.status) {
//         whereClause.status = filters.status.toUpperCase();
//       }
//       if (filters.startDate || filters.endDate) {
//         whereClause.createdAt = {};
//         if (filters.startDate) {
//           whereClause.createdAt.gte = new Date(filters.startDate);
//         }
//         if (filters.endDate) {
//           whereClause.createdAt.lte = new Date(filters.endDate);
//         }
//       }
//     }

//     const [transactions, total] = await Promise.all([
//       this.prisma.transactionReference.findMany({
//         where: whereClause,
//         include: {
//           event: { select: { title: true } },
//           user: { select: { name: true } },
//         },
//         orderBy: { createdAt: 'desc' },
//         skip,
//         take: limit,
//       }),
//       this.prisma.transactionReference.count({
//         where: whereClause,
//       }),
//     ]);

//     return {
//       transactions: transactions.map(txn => this.formatTransaction(txn)),
//       pagination: {
//         page,
//         limit,
//         total,
//         totalPages: Math.ceil(total / limit),
//         hasMore: (page * limit) < total,
//       },
//     };
//   }
// }
