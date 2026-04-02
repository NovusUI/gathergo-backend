import { BadGatewayException, Injectable, InternalServerErrorException } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import * as crypto from 'crypto';

type InitializeAlatTransferInput = {
  reference: string;
  amountKobo: number;
  businessId: string;
  eventTitle?: string;
  displayName?: string | null;
  customer: {
    email: string;
    phone?: string | null;
    firstName: string;
    lastName: string;
    metadata?: Record<string, unknown> | null;
  };
};

type AlatTransactionStatusResult = {
  status: string | null;
  providerReference: string | null;
  reference: string | null;
  amountKobo: number | null;
  feeAmountKobo: number | null;
  payload: Record<string, any>;
};

@Injectable()
export class AlatCollectionService {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: process.env.ALAT_BASE_URL || 'https://api.alatpay.ng',
      timeout: Number(process.env.ALAT_TIMEOUT_MS || 15000),
    });
  }

  async initializeTransfer(input: InitializeAlatTransferInput) {

    const secretKey =
      process.env.ALAT_SECRET_KEY || process.env.ALAT_SUBSCRIPTION_KEY;

    if (!secretKey) {
      throw new InternalServerErrorException('ALAT secret key is not configured');
    }

    if (!input.businessId) {
      throw new InternalServerErrorException(
        'ALAT business ID is not configured for this creator',
      );
    }

    const payload = {
      businessId: process.env.TEMP_BUSINESS_ID || input.businessId,
      amount: this.toNairaAmount(input.amountKobo),
      currency: process.env.ALAT_CURRENCY || 'NGN',
      orderId: input.reference,
      description: input.eventTitle
        ? `GatherGo payment for ${input.eventTitle}`
        : `GatherGo payment ${input.reference}`,
      customer: {
        email: input.customer.email,
        ...(input.customer.phone ? { phone: input.customer.phone } : {}),
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        ...(input.customer.metadata
          ? { metadata: JSON.stringify(input.customer.metadata) }
          : {}),
      },
    };

    let responseData: Record<string, any>;

    try {
      const response = await this.client.post(
        process.env.ALAT_BANK_TRANSFER_PATH ||
          '/bank-transfer/api/v1/bankTransfer/virtualAccount',
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key': secretKey,
          },
        },
      );

      responseData = response.data;
    } catch (error) {
      throw this.toProviderException(error);
    }

    const providerPayload = this.unwrapPayload(responseData);
    const accountNumber = this.pickFirstString(
      providerPayload.virtualBankAccountNumber,
      providerPayload.virtualAccountNumber,
      providerPayload.virtualAccount?.accountNumber,
      providerPayload.accountNumber,
    );
    const accountName = this.pickFirstString(
      providerPayload.virtualBankAccountName,
      providerPayload.virtualAccountName,
      providerPayload.accountName,
      providerPayload.businessName,
      providerPayload.name,
      input.displayName,
    );
    const bankCode = this.pickFirstString(
      providerPayload.virtualBankCode,
      providerPayload.virtualAccount?.bankCode,
      providerPayload.bankCode,
    );
    const expiresAt = this.pickFirstString(
      providerPayload.expiredAt,
      providerPayload.expiresAt,
    );
    const providerReference = this.pickFirstString(
      providerPayload.transactionId,
      providerPayload.providerReference,
      providerPayload.reference,
      input.reference,
    );
    const providerAmount = this.resolveReturnedAmountKobo(
      providerPayload.amount,
      input.amountKobo,
    );

    if (!accountNumber || !accountName) {
      throw new BadGatewayException(
        'ALAT bank transfer response did not include virtual account details',
      );
    }

    return {
      provider: 'ALAT_TRANSFER',
      paymentUrl: null,
      providerReference,
      providerPayload: responseData,
      message:
        this.pickFirstString(responseData.message, providerPayload.statusReason) ||
        'ALAT transfer initialized',
      status:
        typeof responseData.status === 'boolean' ? responseData.status : true,
      instructions: {
        bankName: this.resolveBankName(bankCode),
        accountName,
        accountNumber,
        reference: input.reference,
        providerReference,
        businessId: input.businessId,
        amountKobo: providerAmount,
        amountInNaira: providerAmount / 100,
        narration:
          this.pickFirstString(
            providerPayload.nipTransaction?.narration,
            providerPayload.description,
          ) || `GatherGo ${input.eventTitle || 'payment'} ${input.reference}`,
        expiresAt,
        bankCode,
      },
    };
  }

  async getTransactionStatus(
    transactionId: string,
  ): Promise<AlatTransactionStatusResult> {
    const secretKey =
      process.env.ALAT_SECRET_KEY || process.env.ALAT_SUBSCRIPTION_KEY;

    if (!secretKey) {
      throw new InternalServerErrorException('ALAT secret key is not configured');
    }

    let responseData: Record<string, any>;
    try {
      const response = await this.client.get(
        `${
          process.env.ALAT_BANK_TRANSFER_STATUS_PATH ||
          '/bank-transfer/api/v1/bankTransfer/transactions'
        }/${encodeURIComponent(transactionId)}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key': secretKey,
          },
        },
      );

      responseData = response.data;
    } catch (error) {
      throw this.toProviderException(error);
    }

    const providerPayload = this.unwrapPayload(responseData);

    return {
      status: this.pickFirstString(
        providerPayload.status,
        providerPayload.transactionStatus,
      ),
      providerReference: this.pickFirstString(
        providerPayload.transactionId,
        providerPayload.providerReference,
      ),
      reference: this.pickFirstString(
        providerPayload.orderId,
        providerPayload.reference,
        providerPayload.transactionReference,
      ),
      amountKobo: this.resolveReturnedAmountKobo(
        providerPayload.amountSent ?? providerPayload.amount,
        0,
      ),
      feeAmountKobo: this.resolveReturnedAmountKobo(providerPayload.feeAmount, 0),
      payload: responseData,
    };
  }

  verifyWebhookSignature(rawBody: Buffer | undefined, signature?: string) {
    const secret = process.env.ALAT_WEBHOOK_SECRET;

    if (!secret || !rawBody || !signature) {
      return false;
    }

    const computedSignature = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');

    return (
      computedSignature.length === signature.length &&
      crypto.timingSafeEqual(
        Buffer.from(computedSignature, 'utf8'),
        Buffer.from(signature, 'utf8'),
      )
    );
  }

  private unwrapPayload(data: Record<string, any>) {
    return (data?.data as Record<string, any>) || data;
  }

  private toNairaAmount(amountKobo: number) {
    return Number((amountKobo / 100).toFixed(2));
  }

  private resolveReturnedAmountKobo(amount: unknown, fallbackAmountKobo: number) {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return fallbackAmountKobo;
    }

    const parsedKobo = Math.round(numericAmount * 100);
    if (parsedKobo === fallbackAmountKobo) {
      return parsedKobo;
    }

    if (Math.round(numericAmount) === fallbackAmountKobo) {
      return Math.round(numericAmount);
    }

    return fallbackAmountKobo;
  }

  private resolveBankName(bankCode?: string | null) {
    if (!bankCode) {
      return process.env.ALAT_COLLECTION_BANK_NAME || 'Wema Bank';
    }

    if (bankCode === '035') {
      return 'Wema Bank';
    }

    return process.env.ALAT_COLLECTION_BANK_NAME || 'Wema Bank';
  }

  private pickFirstString(...values: Array<unknown>) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return null;
  }

  private toProviderException(error: unknown) {
    if (error instanceof AxiosError) {
      const providerMessage =
        (error.response?.data as Record<string, any> | undefined)?.message ||
        (error.response?.data as Record<string, any> | undefined)?.error ||
        error.message;

      return new BadGatewayException(
        `ALAT bank transfer request failed: ${providerMessage}`,
      );
    }

    return new BadGatewayException('ALAT bank transfer request failed');
  }
}
