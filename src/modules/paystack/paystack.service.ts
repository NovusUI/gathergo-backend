import { Injectable } from '@nestjs/common';
import axios from 'axios';
import {
  PaystackBanksResponse,
  PaystackResolveAccountResponse,
  PaystackResponse,
  PaystackResult,
  PaystackVerifiedTransaction,
  PaystackRefund,
} from './types/paystack-response.type';

@Injectable()
export class PaystackService {
  private readonly paystackBaseUrl = 'https://api.paystack.co';

  async initializeTransaction(data: {
    email: string;
    amount: number; // amount in kobo
    reference: string;
    callback_url: string;
    metadata: {
      cancel_action: string;
    };
  }): Promise<PaystackResponse> {
    const res = await axios.post(
      `${this.paystackBaseUrl}/transaction/initialize`,
      data,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );
    return res.data;
  }

  async verifyTransaction(
    reference: string,
  ): Promise<PaystackResult<PaystackVerifiedTransaction>> {
    const res = await axios.get(
      `${this.paystackBaseUrl}/transaction/verify/${reference}`,
      {
        timeout: 10000,
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
    );
    return res.data;
  }

  async createRefund(
    reference: string,
    amount: number,
  ): Promise<PaystackResult<PaystackRefund>> {
    const response = await axios.post<PaystackResult<PaystackRefund>>(
      `${this.paystackBaseUrl}/refund`,
      {
        transaction: reference,
        amount,
        currency: 'NGN',
        merchant_note: 'GatherGo checkout capacity unavailable',
      },
      {
        timeout: 20000,
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      },
    );
    if (!response.data.status) throw new Error(response.data.message);
    return response.data;
  }

  async listRefunds(
    providerTransactionId: string,
  ): Promise<PaystackResult<PaystackRefund[]>> {
    const response = await axios.get<PaystackResult<PaystackRefund[]>>(
      `${this.paystackBaseUrl}/refund`,
      {
        params: { transaction: providerTransactionId, perPage: 100 },
        timeout: 20000,
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      },
    );
    if (!response.data.status) throw new Error(response.data.message);
    return response.data;
  }

  async listBanks(country = 'nigeria'): Promise<PaystackBanksResponse> {
    const res = await axios.get(`${this.paystackBaseUrl}/bank`, {
      params: { country },
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });
    return res.data;
  }

  async resolveBankAccount(input: {
    accountNumber: string;
    bankCode: string;
  }): Promise<PaystackResolveAccountResponse> {
    console.log(input.bankCode, 'bank code');
    const res = await axios.get(`${this.paystackBaseUrl}/bank/resolve`, {
      params: {
        account_number: input.accountNumber,
        bank_code: input.bankCode,
      },
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });
    return res.data;
  }
}
