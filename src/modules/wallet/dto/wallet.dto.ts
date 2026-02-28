import { ApiProperty } from '@nestjs/swagger';

export class WalletBalanceDto {
  @ApiProperty({ example: 150000.5, description: 'Available balance' })
  availableBalance: number;

  @ApiProperty({ example: 50000.25, description: 'Pending balance' })
  pendingBalance: number;

  @ApiProperty({ example: 200000.75, description: 'Total balance' })
  totalBalance: number;

  @ApiProperty({ example: 'NGN', description: 'Currency' })
  currency: string;
}

export class TransactionDto {
  @ApiProperty({ example: 'txn_123456', description: 'Transaction ID' })
  id: string;

  @ApiProperty({
    example: 'Event Payment',
    description: 'Transaction description',
  })
  description: string;

  @ApiProperty({ example: 50000, description: 'Transaction amount' })
  amount: number;

  @ApiProperty({
    enum: ['credit', 'debit'],
    example: 'credit',
    description: 'Transaction type',
  })
  type: 'credit' | 'debit';

  @ApiProperty({
    enum: ['completed', 'pending', 'failed'],
    example: 'completed',
    description: 'Transaction status',
  })
  status: 'completed' | 'pending' | 'failed';

  @ApiProperty({ example: 'John Doe', description: 'Counterparty name' })
  counterparty: string;

  @ApiProperty({
    example: '2024-01-25T10:30:00Z',
    description: 'Transaction date',
  })
  date: string;

  @ApiProperty({ example: 'Event: Feed500', description: 'Related event name' })
  event?: string;

  @ApiProperty({ example: '#5669FF', description: 'Transaction color for UI' })
  color?: string;
}

export class PaymentMethodDto {
  @ApiProperty({ example: 'bank_123', description: 'Payment method ID' })
  id: string;

  @ApiProperty({
    enum: ['bank', 'card', 'mobile_money'],
    example: 'bank',
    description: 'Payment method type',
  })
  type: 'bank' | 'card' | 'mobile_money';

  @ApiProperty({ example: 'Zenith Bank', description: 'Bank/Provider name' })
  provider: string;

  @ApiProperty({ example: '0087623525', description: 'Account/Card number' })
  accountNumber: string;

  @ApiProperty({ example: 'John Doe', description: 'Account holder name' })
  accountName: string;

  @ApiProperty({
    example: true,
    description: 'Whether this is the default method',
  })
  isDefault: boolean;

  @ApiProperty({ example: '#FF932E', description: 'Icon color' })
  color: string;
}

export class WithdrawalRequestDto {
  @ApiProperty({ example: 50000, description: 'Amount to withdraw' })
  amount: number;

  @ApiProperty({ example: 'bank_123', description: 'Payment method ID' })
  paymentMethodId: string;
}

export class WalletResponseDto {
  @ApiProperty({
    type: WalletBalanceDto,
    description: 'Wallet balance information',
  })
  balance: WalletBalanceDto;

  @ApiProperty({ type: [TransactionDto], description: 'Recent transactions' })
  transactions: TransactionDto[];

  @ApiProperty({ type: [PaymentMethodDto], description: 'Payment methods' })
  paymentMethods: PaymentMethodDto[];

  @ApiProperty({ example: true, description: 'Success indicator' })
  success: boolean;

  @ApiProperty({
    example: 'Wallet data retrieved successfully',
    description: 'Success message',
  })
  message: string;
}
