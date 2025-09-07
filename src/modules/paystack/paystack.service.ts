import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { VerifyPaystackDto } from './dto/verify-paystack.dto';
import { PaystackResponse } from './types/paystack-response.type';

@Injectable()
export class PaystackService {
  private readonly paystackBaseUrl = 'https://api.paystack.co';

  async initializeTransaction(data: {
    email: string;
    amount: number; // amount in kobo
    reference: string;
    callback_url: string;
    metadata:{
      cancel_action: string
    }
  }): Promise<PaystackResponse> {
    const res = await axios.post(`${this.paystackBaseUrl}/transaction/initialize`, data, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    return res.data;
  }

  async verifyTransaction(reference: string): Promise<PaystackResponse> {
    const res = await axios.get(`${this.paystackBaseUrl}/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });
    return res.data;
  }
}
