import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import * as crypto from 'crypto';

type QoreIdTokenResponse = {
  accessToken?: string;
  access_token?: string;
  token?: string;
  expiresIn?: number;
  expires_in?: number;
};

type QoreIdStatus = {
  state?: string;
  status?: string;
};

type QoreIdNameMatchSummary = {
  status?: string;
  fieldMatches?: Record<string, boolean>;
};

type QoreIdFaceVerificationSummary = {
  match?: boolean;
  match_score?: number;
  matching_threshold?: number;
  max_score?: number;
};

type QoreIdIdentityRecord = {
  nin?: string;
  vnin?: string;
  virtualNin?: string;
  passportNo?: string;
  firstname?: string;
  lastname?: string;
  middlename?: string;
  phone?: string;
  gender?: string;
  birthdate?: string;
  photo?: string;
};

export type QoreIdNubanResponse = {
  id: number | string;
  applicant?: {
    firstname?: string;
    lastname?: string;
    accountNumber?: string;
    bankCode?: string;
  };
  summary?: {
    nuban_check?: QoreIdNameMatchSummary;
  };
  status?: QoreIdStatus;
  nuban?: {
    firstname?: string;
    lastname?: string;
    middlename?: string;
    accountName?: string;
    accountNumber?: string;
    dob?: string;
    accountCurrency?: string;
    mobileNumber?: string;
    bvn?: string;
  };
};

export type QoreIdNinResponse = {
  id: number | string;
  summary?: Record<string, QoreIdNameMatchSummary | string | undefined>;
  status?: QoreIdStatus;
  insight?: Array<{
    serviceCategory?: string;
    insightCount?: number;
    timeframeInMonths?: number;
  }>;
  nin?: QoreIdIdentityRecord & {
    address?: string;
  };
  virtual_nin?: QoreIdIdentityRecord;
  passport?: QoreIdIdentityRecord & {
    issuedAt?: string;
    issuedDate?: string;
    expiryDate?: string;
  };
};

export type QoreIdCacResponse = {
  id: number | string;
  summary?: {
    cac_check?: string;
  };
  status?: QoreIdStatus;
  cac?: {
    rcNumber?: string;
    companyName?: string;
    companyType?: string;
    registrationDate?: string;
    branchAddress?: string;
    companyEmail?: string;
    city?: string;
    headOfficeAddress?: string;
    lga?: string;
    affiliates?: string;
    state?: string;
    status?: string;
  };
};

export type QoreIdBank = {
  name?: string;
  code?: string;
  longcode?: string;
};

export type QoreIdFaceVerificationResponse = {
  id: number | string;
  summary?: {
    face_verification_check?: QoreIdFaceVerificationSummary;
  };
  status?: QoreIdStatus;
  face_verification?: QoreIdIdentityRecord;
};

@Injectable()
export class QoreIdService {
  private readonly logger = new Logger(QoreIdService.name);
  private readonly client: AxiosInstance;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: process.env.QOREID_BASE_URL || 'https://api.qoreid.com',
      timeout: Number(process.env.QOREID_TIMEOUT_MS || 15000),
    });
  }

  async verifyNuban(input: {
    firstName: string;
    lastName: string;
    accountNumber: string;
    bankCode: string;
    dateOfBirth?: string | null;
    phone?: string | null;
  }) {
    if (this.isMockMode()) {
      return this.buildMockNubanResponse(input);
    }

    return this.authorizedPost<QoreIdNubanResponse>('/v1/ng/identities/nuban', {
      firstname: input.firstName,
      lastname: input.lastName,
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
      ...(input.dateOfBirth ? { dob: input.dateOfBirth } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
    });
  }

  async verifyNin(input: {
    nin: string;
    firstName: string;
    lastName: string;
    middleName?: string | null;
    dateOfBirth?: string | null;
    phone?: string | null;
    email?: string | null;
    gender?: string | null;
  }) {
    if (this.isMockMode()) {
      return this.buildMockIdentityResponse('nin', input.nin, input);
    }

    return this.authorizedPost<QoreIdNinResponse>(
      `/v1/ng/identities/nin/${encodeURIComponent(input.nin)}`,
      {
        firstname: input.firstName,
        lastname: input.lastName,
        ...(input.middleName ? { middlename: input.middleName } : {}),
        ...(input.dateOfBirth ? { dob: input.dateOfBirth } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.email ? { email: input.email } : {}),
        ...(input.gender ? { gender: input.gender } : {}),
      },
    );
  }

  async verifyNinByPhone(input: {
    phoneNumber: string;
    firstName: string;
    lastName: string;
    dateOfBirth?: string | null;
    phone?: string | null;
    email?: string | null;
    gender?: string | null;
  }) {
    if (this.isMockMode()) {
      return this.buildMockIdentityResponse('nin-phone', input.phoneNumber, input);
    }

    return this.authorizedPost<QoreIdNinResponse>(
      `/v1/ng/identities/nin-phone/${encodeURIComponent(input.phoneNumber)}`,
      {
        firstname: input.firstName,
        lastname: input.lastName,
        ...(input.dateOfBirth ? { dob: input.dateOfBirth } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.email ? { email: input.email } : {}),
        ...(input.gender ? { gender: input.gender } : {}),
      },
    );
  }

  async verifyVirtualNin(input: {
    vnin: string;
    firstName: string;
    lastName: string;
    middleName?: string | null;
    dateOfBirth?: string | null;
    phone?: string | null;
    email?: string | null;
    gender?: string | null;
  }) {
    if (this.isMockMode()) {
      return this.buildMockIdentityResponse('virtual-nin', input.vnin, input);
    }

    return this.authorizedPost<QoreIdNinResponse>(
      `/v1/ng/identities/virtual-nin/${encodeURIComponent(input.vnin)}`,
      {
        firstname: input.firstName,
        lastname: input.lastName,
        ...(input.middleName ? { middlename: input.middleName } : {}),
        ...(input.dateOfBirth ? { dob: input.dateOfBirth } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.email ? { email: input.email } : {}),
        ...(input.gender ? { gender: input.gender } : {}),
      },
    );
  }

  async verifyPassport(input: {
    passportNumber: string;
    firstName: string;
    lastName: string;
    middleName?: string | null;
    dateOfBirth?: string | null;
    phone?: string | null;
    email?: string | null;
    gender?: string | null;
  }) {
    if (this.isMockMode()) {
      return this.buildMockIdentityResponse('passport', input.passportNumber, input);
    }

    return this.authorizedPost<QoreIdNinResponse>(
      `/v1/ng/identities/passport/${encodeURIComponent(input.passportNumber)}`,
      {
        firstname: input.firstName,
        lastname: input.lastName,
        ...(input.middleName ? { middlename: input.middleName } : {}),
        ...(input.dateOfBirth ? { dob: input.dateOfBirth } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.email ? { email: input.email } : {}),
        ...(input.gender ? { gender: input.gender } : {}),
      },
    );
  }

  async verifyCacBasic(input: { regNumber: string }) {
    if (this.isMockMode()) {
      return this.buildMockCacResponse(input.regNumber);
    }

    return this.authorizedPost<QoreIdCacResponse>('/v1/ng/identities/cac-basic', {
      regNumber: input.regNumber,
    });
  }

  async verifyFaceMatch(input: {
    idType: 'nin' | 'vnin' | 'nigerian_passport';
    idNumber: string;
    photoUrl?: string | null;
    photoBase64?: string | null;
  }) {
    if (this.isMockMode()) {
      return this.buildMockFaceVerificationResponse(input);
    }

    return this.authorizedPost<QoreIdFaceVerificationResponse>(
      `/v1/ng/identities/face-verification/${input.idType}`,
      {
        idNumber: input.idNumber,
        ...(input.photoUrl ? { photoUrl: input.photoUrl } : {}),
        ...(input.photoBase64 ? { photoBase64: input.photoBase64 } : {}),
      },
    );
  }

  async getNubanBanks() {
    if (this.isMockMode()) {
      return this.buildMockBanks();
    }

    return this.authorizedGet<QoreIdBank[]>('/v1/banks');
  }

  verifyWebhookSignature(
    payload: Record<string, unknown>,
    rawBody: Buffer | undefined,
    signature?: string,
  ) {
    const secret = process.env.QOREID_WEBHOOK_SECRET;

    if (!secret || !signature) {
      return false;
    }

    const payloadSource = rawBody
      ? rawBody
      : Buffer.from(JSON.stringify(payload));
    const computedSignature = crypto
      .createHmac('sha512', secret)
      .update(payloadSource)
      .digest('hex');

    if (computedSignature.length !== signature.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(computedSignature),
      Buffer.from(signature),
    );
  }

  private async authorizedPost<T>(path: string, data: Record<string, unknown>) {
    const token = await this.getAccessToken();

    try {
      const response = await this.client.post<T>(path, data, {
        headers: {
          accept: 'application/json', 
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error) {
      //  console.log(error)
      throw this.toProviderException(error);
    }
  }

  private async authorizedGet<T>(path: string) {
    const token = await this.getAccessToken();

    try {
      const response = await this.client.get<T>(path, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error) {
      throw this.toProviderException(error);
    }
  }

  private async getAccessToken() {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 30_000) {
      return this.cachedToken.value;
    }

    const clientId = process.env.QOREID_CLIENT_ID;
    const clientSecret = process.env.QOREID_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      this.logger.error('QoreID credentials are not configured');
      throw new InternalServerErrorException(
        'Verification service is temporarily unavailable. Please try again later.',
      );
    }

    try {
      const response = await this.client.post<QoreIdTokenResponse>('/token', {
        clientId,
        secret: clientSecret,
      });

      const token =
        response.data.accessToken ||
        response.data.access_token ||
        response.data.token;
      const expiresInSeconds = Number(
        response.data.expiresIn || response.data.expires_in || 3600,
      );

      if (!token) {
        this.logger.error('QoreID token response did not include an access token');
        throw new InternalServerErrorException(
          'Verification service is temporarily unavailable. Please try again later.',
        );
      }

      this.cachedToken = {
        value: token,
        expiresAt: now + expiresInSeconds * 1000,
      };

      return token;
    } catch (error) {

      throw this.toProviderException(error);
    }
  }

  private toProviderException(error: unknown) {
    if (error instanceof AxiosError) {
      this.logger.warn(
        `QoreID request failed with status ${error.response?.status || 'unknown'}`,
        typeof error.response?.data === 'string'
          ? error.response.data
          : JSON.stringify(error.response?.data || { message: error.message }),
      );

      if (error.response?.status === 429) {
        return new ServiceUnavailableException(
          'Verification service is busy right now. Please try again shortly.',
        );
      }

      return new BadGatewayException(
        'Verification service is temporarily unavailable. Please try again later.',
      );
    }

    this.logger.warn('QoreID request failed', error as Error);

    return new BadGatewayException(
      'Verification service is temporarily unavailable. Please try again later.',
    );
  }

  private isMockMode() {
    return (process.env.QOREID_MOCK_MODE || '').toLowerCase() === 'true';
  }

  private buildMockNubanResponse(input: {
    firstName: string;
    lastName: string;
    accountNumber: string;
    bankCode: string;
    dateOfBirth?: string | null;
    phone?: string | null;
  }): QoreIdNubanResponse {
    const scenario = this.resolveMockScenario(input.accountNumber, input.bankCode);
    const accountName = `${input.firstName} ${input.lastName}`.trim().toUpperCase();

    return {
      id: this.generateMockId('nuban'),
      applicant: {
        firstname: input.firstName,
        lastname: input.lastName,
        accountNumber: input.accountNumber,
        bankCode: input.bankCode,
      },
      summary: {
        nuban_check: {
          status:
            scenario === 'failed'
              ? 'NO_MATCH'
              : scenario === 'pending'
                ? 'PENDING'
                : 'EXACT_MATCH',
        },
      },
      status: {
        status:
          scenario === 'failed'
            ? 'failed'
            : scenario === 'pending'
              ? 'pending'
              : 'verified',
      },
      nuban: {
        firstname: input.firstName,
        lastname: input.lastName,
        accountName,
        accountNumber: input.accountNumber,
        dob: input.dateOfBirth || undefined,
        mobileNumber: input.phone || undefined,
        accountCurrency: 'NGN',
      },
    };
  }

  private buildMockIdentityResponse(
    type: 'nin' | 'nin-phone' | 'virtual-nin' | 'passport',
    identifier: string,
    input: {
      firstName: string;
      lastName: string;
      middleName?: string | null;
      dateOfBirth?: string | null;
      phone?: string | null;
      email?: string | null;
      gender?: string | null;
    },
  ): QoreIdNinResponse {
    const scenario = this.resolveMockScenario(identifier, input.phone, input.email);
    const payload: QoreIdNinResponse = {
      id: this.generateMockId(type),
      status: {
        status:
          scenario === 'failed'
            ? 'failed'
            : scenario === 'pending'
              ? 'pending'
              : 'verified',
      },
      summary: {
        identity_check:
          scenario === 'failed'
            ? 'NO_MATCH'
            : scenario === 'pending'
              ? 'PENDING'
              : 'EXACT_MATCH',
      },
      insight: [],
    };

    const record = {
      firstname: input.firstName,
      lastname: input.lastName,
      middlename: input.middleName || undefined,
      phone: input.phone || undefined,
      gender: input.gender || undefined,
      birthdate: input.dateOfBirth || undefined,
    };

    if (type === 'nin') {
      payload.nin = { ...record, nin: identifier };
    } else if (type === 'virtual-nin') {
      payload.virtual_nin = { ...record, vnin: identifier, virtualNin: identifier };
    } else if (type === 'passport') {
      payload.passport = {
        ...record,
        passportNo: identifier,
        issuedAt: '2025-01-01',
        expiryDate: '2030-01-01',
      };
    } else {
      payload.nin = { ...record, nin: '00000000000' };
    }

    return payload;
  }

  private buildMockCacResponse(regNumber: string): QoreIdCacResponse {
    const scenario = this.resolveMockScenario(regNumber);

    return {
      id: this.generateMockId('cac'),
      summary: {
        cac_check:
          scenario === 'failed'
            ? 'rejected'
            : scenario === 'pending'
              ? 'pending'
              : 'verified',
      },
      status: {
        status:
          scenario === 'failed'
            ? 'failed'
            : scenario === 'pending'
              ? 'pending'
              : 'verified',
      },
      cac: {
        rcNumber: regNumber,
        companyName: `Mock Business ${regNumber}`,
        companyType: 'PRIVATE COMPANY',
        registrationDate: '2024-01-01',
        status: scenario === 'failed' ? 'INACTIVE' : 'ACTIVE',
      },
    };
  }

  private buildMockFaceVerificationResponse(input: {
    idType: 'nin' | 'vnin' | 'nigerian_passport';
    idNumber: string;
    photoUrl?: string | null;
    photoBase64?: string | null;
  }): QoreIdFaceVerificationResponse {
    const scenario = this.resolveMockScenario(input.idNumber);

    return {
      id: this.generateMockId('face'),
      status: {
        status:
          scenario === 'failed'
            ? 'failed'
            : scenario === 'pending'
              ? 'pending'
              : 'verified',
      },
      summary: {
        face_verification_check: {
          match: scenario === 'verified',
          match_score: scenario === 'verified' ? 0.98 : scenario === 'pending' ? 0 : 0.21,
          matching_threshold: 0.75,
          max_score: 1,
        },
      },
      face_verification: {
        photo: input.photoUrl || (input.photoBase64 ? 'mock-base64-image' : undefined),
      },
    };
  }

  private buildMockBanks(): QoreIdBank[] {
    return [
      { name: 'Access Bank', code: '044', longcode: '044150149' },
      { name: 'First Bank', code: '011', longcode: '011151003' },
      { name: 'GTBank', code: '058', longcode: '058152036' },
      { name: 'Opay', code: '999992', longcode: '999992' },
      { name: 'PalmPay', code: '999991', longcode: '999991' },
      { name: 'Sterling Bank', code: '232', longcode: '232150016' },
      { name: 'UBA', code: '033', longcode: '033153513' },
      { name: 'Union Bank', code: '032', longcode: '032080474' },
      { name: 'Wema Bank', code: '035', longcode: '035150103' },
      { name: 'Zenith Bank', code: '057', longcode: '057150013' },
    ];
  }

  private resolveMockScenario(...values: Array<string | null | undefined>) {
    const normalized = values
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (
      normalized.includes('fail') ||
      normalized.includes('reject') ||
      normalized.endsWith('9999')
    ) {
      return 'failed' as const;
    }

    if (
      normalized.includes('pending') ||
      normalized.includes('wait') ||
      normalized.endsWith('1111')
    ) {
      return 'pending' as const;
    }

    return 'verified' as const;
  }

  private generateMockId(prefix: string) {
    return `mock-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
}
