import { Injectable } from '@nestjs/common';
import axios from 'axios';
import {
  PaystackBanksResponse,
  PaystackResolveAccountResponse,
  PaystackResponse,
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

  async verifyTransaction(reference: string): Promise<PaystackResponse> {
    const res = await axios.get(
      `${this.paystackBaseUrl}/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
    );
    return res.data;
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
