import {
  PaymentProvider,
  PaymentType,
  Prisma,
  TransactionReference,
} from '@prisma/client';
import { PaymentClientContextDto } from '../transaction-reference/dto/payment-provider.dto';
import { PricingSummary } from '../transaction-reference/payment-pricing.util';

export type PurchasedTicketItem = {
  eventTicketId: string;
  quantity: number;
  ticketName: string;
};

export type CheckoutMetadata = {
  type: PaymentType;
  amountUnit: 'KOBO';
  eventId: string;
  eventTitle: string;
  pricing: PricingSummary;
  clientContext?: Pick<PaymentClientContextDto, 'deviceId' | 'platform'> | null;
  paidTickets?: (PurchasedTicketItem & {
    totalPriceKobo: number;
    totalPriceNaira: number;
  })[];
  freeTickets?: PurchasedTicketItem[];
  providerInstructions?: Prisma.JsonObject | null;
  sponsorship?: {
    beneficiaryType: 'SPONSORED';
    sponsorshipNote?: string | null;
    status: 'PENDING_PAYMENT' | 'PENDING_ASSIGNMENT';
  };
};

export const checkoutInclude = {
  reservation: { include: { items: true } },
  refund: true,
} satisfies Prisma.TransactionReferenceInclude;

export type CheckoutRecord = Prisma.TransactionReferenceGetPayload<{
  include: typeof checkoutInclude;
}>;
export type IssuanceTransaction = Pick<
  TransactionReference,
  'id' | 'userId' | 'eventId'
>;

export type CreateCheckoutInput = {
  userId: string;
  eventId: string;
  idempotencyKey: string;
  requestHash: string;
  paymentType: 'TICKET' | 'REGISTRATION';
  provider: PaymentProvider;
  metadata: CheckoutMetadata;
  data: Omit<
    Prisma.TransactionReferenceUncheckedCreateInput,
    'userId' | 'eventId' | 'paymentType' | 'paymentProvider' | 'metadata'
  >;
};

export type CollectedCheckoutInput = {
  transactionId: string;
  amountKobo: number;
  providerReference?: string | null;
  providerTransactionId?: string;
  providerPayload: Prisma.InputJsonValue;
  providerFeeKobo: number;
  settlementStatus: TransactionReference['settlementStatus'];
  pricing: PricingSummary;
};

export const checkoutTicketItems = (
  metadata: CheckoutMetadata,
): PurchasedTicketItem[] => [
  ...(metadata.paidTickets ?? []),
  ...(metadata.freeTickets ?? []),
];
