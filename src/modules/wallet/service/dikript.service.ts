import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import * as crypto from 'crypto';

type DikriptEnvelope<T = unknown> = {
  status?: boolean;
  message?: string;
  code?: string;
  apiVersion?: string;
  transactionRef?: string;
  data?: T | string | null;
  error?: {
    code?: number | string | null;
    message?: string | null;
  } | null;
};

type DikriptStatus = {
  state?: string;
  status?: string;
};

type DikriptNameMatchSummary = {
  status?: string;
  fieldMatches?: Record<string, boolean>;
};

type DikriptFaceVerificationSummary = {
  match?: boolean;
  match_score?: number;
  matching_threshold?: number | null;
  max_score?: number;
};

type DikriptIdentityRecord = {
  nin?: string;
  bvn?: string;
  phoneNumber?: string;
  phone?: string;
  passportNo?: string;
  firstname?: string;
  lastname?: string;
  middlename?: string;
  gender?: string;
  birthdate?: string;
  address?: string;
  photo?: string;
};

type DikriptIdentityPayload = Record<string, unknown>;

export type DikriptCacAffiliate = {
  surname?: string;
  firstname?: string;
  othername?: string;
  status?: string;
  affiliateType?: {
    name?: string;
  };
};

export type DikriptNubanResponse = {
  id: number | string;
  provider?: 'DIKRIPT';
  raw?: DikriptEnvelope;
  applicant?: {
    firstname?: string;
    lastname?: string;
    accountNumber?: string;
    bankCode?: string;
  };
  summary?: {
    nuban_check?: DikriptNameMatchSummary;
  };
  status?: DikriptStatus;
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
    bankName?: string;
  };
};

export type DikriptNinResponse = {
  id: number | string;
  provider?: 'DIKRIPT';
  raw?: DikriptEnvelope;
  summary?: Record<string, DikriptNameMatchSummary | string | undefined>;
  status?: DikriptStatus;
  insight?: Array<{
    serviceCategory?: string;
    insightCount?: number;
    timeframeInMonths?: number;
  }>;
  nin?: DikriptIdentityRecord;
  bvn?: DikriptIdentityRecord;
  phone?: DikriptIdentityRecord;
  virtual_nin?: DikriptIdentityRecord;
  passport?: DikriptIdentityRecord & {
    issuedAt?: string;
    issuedDate?: string;
    expiryDate?: string;
  };
};

export type DikriptCacResponse = {
  id: number | string;
  provider?: 'DIKRIPT';
  raw?: DikriptEnvelope;
  summary?: {
    cac_check?: string;
  };
  status?: DikriptStatus;
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
    affiliatesData?: DikriptCacAffiliate[];
    state?: string;
    status?: string;
  };
};

export type DikriptBank = {
  name?: string;
  code?: string;
  longcode?: string;
  country?: string;
};

export type DikriptFaceVerificationIdType = 'NIN' | 'BVN' | 'PHONENUMBER';

export type DikriptFaceVerificationResponse = {
  id: number | string;
  provider?: 'DIKRIPT';
  raw?: DikriptEnvelope;
  summary?: {
    face_verification_check?: DikriptFaceVerificationSummary;
  };
  status?: DikriptStatus;
  face_verification?: DikriptIdentityRecord;
};

@Injectable()
export class DikriptService {
  private readonly logger = new Logger(DikriptService.name);
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: process.env.DIKRIPT_BASE_URL || 'https://api.dikript.com',
      timeout: Number(process.env.DIKRIPT_TIMEOUT_MS || 15000),
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

    const response = await this.authorizedGet<DikriptEnvelope>(
      `${this.verificationPath('getaccount')}/${encodeURIComponent(
        input.accountNumber,
      )}/${encodeURIComponent(input.bankCode)}`,
    );

    return this.mapNubanResponse(response, input);
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

    const response = await this.authorizedGet<DikriptEnvelope>(
      this.verificationPath('getnin'),
      { nin: input.nin },
    );

    return this.mapIdentityResponse('nin', input.nin, response, input);
  }

  async verifyBvn(input: {
    bvn: string;
    firstName: string;
    lastName: string;
    middleName?: string | null;
    dateOfBirth?: string | null;
    phone?: string | null;
    email?: string | null;
    gender?: string | null;
  }) {
    if (this.isMockMode()) {
      return this.buildMockIdentityResponse('bvn', input.bvn, input);
    }

    const endpoint = this.useAdvancedBvn()
      ? this.verificationPath('getbvnin')
      : this.verificationPath('getbvn');
    const response = await this.authorizedGet<DikriptEnvelope>(endpoint, {
      bvn: input.bvn,
    });

    return this.mapIdentityResponse('bvn', input.bvn, response, input);
  }

  async verifyPhone(input: {
    phoneNumber: string;
    firstName: string;
    lastName: string;
    dateOfBirth?: string | null;
    phone?: string | null;
    email?: string | null;
    gender?: string | null;
  }) {
    if (this.isMockMode()) {
      return this.buildMockIdentityResponse('phone', input.phoneNumber, input);
    }

    const response = await this.authorizedGet<DikriptEnvelope>(
      this.verificationPath('getphonenumberbasic'),
      { phoneNo: input.phoneNumber },
    );

    return this.mapIdentityResponse(
      'phone',
      input.phoneNumber,
      response,
      input,
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
      return this.buildMockIdentityResponse(
        'nin-phone',
        input.phoneNumber,
        input,
      );
    }

    const response = await this.authorizedGet<DikriptEnvelope>(
      this.verificationPath('getphonenumber'),
      { phoneNo: input.phoneNumber },
    );

    return this.mapIdentityResponse('nin', input.phoneNumber, response, input);
  }

  verifyVirtualNin(input: {
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

    throw new BadRequestException(
      'Dikript does not currently support vNIN verification in this KYC flow. Use NIN, BVN, or phone instead.',
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
      return this.buildMockIdentityResponse(
        'passport',
        input.passportNumber,
        input,
      );
    }

    const response = await this.authorizedPost<DikriptEnvelope>(
      this.verificationPath('getpassport'),
      {
        number: input.passportNumber,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
      },
    );

    return this.mapIdentityResponse(
      'passport',
      input.passportNumber,
      response,
      input,
    );
  }

  async verifyCacBasic(input: { regNumber: string }) {
    if (this.isMockMode()) {
      return this.buildMockCacResponse(input.regNumber);
    }

    const response = await this.authorizedGet<DikriptEnvelope>(
      this.verificationPath('getcacbasic'),
      { regNumber: input.regNumber },
    );

    return this.mapCacResponse(response, input.regNumber);
  }

  async verifyCacAdvanced(input: { regNumber: string }) {
    if (this.isMockMode()) {
      return this.buildMockCacResponse(input.regNumber, true);
    }

    const response = await this.authorizedGet<DikriptEnvelope>(
      this.verificationPath('getcacadvanced'),
      { regNumber: input.regNumber },
    );

    return this.mapCacAdvancedResponse(response, input.regNumber);
  }

  async verifyFaceMatch(input: {
    idType: DikriptFaceVerificationIdType;
    idNumber: string;
    photoUrl?: string | null;
    photoBase64?: string | null;
  }) {
    if (this.isMockMode()) {
      return this.buildMockFaceVerificationResponse(input);
    }

    const form = new FormData();
    form.append('idType', input.idType);
    form.append('idNumber', input.idNumber);

    if (input.photoUrl) {
      form.append('ImageUrl', input.photoUrl);
    } else if (input.photoBase64) {
      form.append('ImageBase64String', this.stripDataUri(input.photoBase64));
    }

    const response = await this.authorizedPost<DikriptEnvelope>(
      '/dikript/api/v1/biometrics/identitycomparison',
      form,
    );

    return this.mapFaceVerificationResponse(response);
  }

  async verifyLiveness(input: {
    photoUrl?: string | null;
    photoBase64?: string | null;
  }) {
    if (this.isMockMode()) {
      return this.buildMockLivenessResponse(input);
    }

    const form = new FormData();

    if (input.photoUrl) {
      form.append('ImageUrl', input.photoUrl);
    } else if (input.photoBase64) {
      form.append('ImageBase64String', this.stripDataUri(input.photoBase64));
    }

    const response = await this.authorizedPost<DikriptEnvelope>(
      '/dikript/api/v1/biometrics/livelinesscheck',
      form,
    );

    return this.mapLivenessResponse(response);
  }

  async getNubanBanks() {
    if (this.isMockMode()) {
      return this.buildMockBanks();
    }

    const response = await this.authorizedGet<
      DikriptEnvelope<DikriptBank[]> | DikriptBank[]
    >('/dikript/wallet/api/v1/banks');

    if (Array.isArray(response)) {
      return response;
    }

    return Array.isArray(response.data) ? response.data : [];
  }

  verifyWebhookSignature(
    payload: Record<string, unknown>,
    rawBody: Buffer | undefined,
    signature?: string,
  ) {
    const secret =
      process.env.DIKRIPT_WEBHOOK_SECRET || process.env.VERIFIDE_WEBHOOK_SECRET;

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

  private async authorizedGet<T>(
    path: string,
    params?: Record<string, unknown>,
  ) {
    try {
      const response = await this.client.get<T>(path, {
        params,
        headers: this.authHeaders(),
      });

      return response.data;
    } catch (error) {
      throw this.toProviderException(error);
    }
  }

  private async authorizedPost<T>(
    path: string,
    data: Record<string, unknown> | FormData,
  ) {
    try {
      const contentHeaders =
        data instanceof FormData ? {} : { 'content-type': 'application/json' };
      const response = await this.client.post<T>(path, data, {
        headers: {
          ...this.authHeaders(),
          ...contentHeaders,
        },
      });

      return response.data;
    } catch (error) {
      throw this.toProviderException(error);
    }
  }

  private authHeaders() {
    const apiKey = this.apiKey();

    if (!apiKey) {
      this.logger.error('Dikript secret key is not configured');
      throw new InternalServerErrorException(
        'Verification service is temporarily unavailable. Please try again later.',
      );
    }

    return {
      accept: 'application/json',
      'x-api-key': apiKey,
    };
  }

  private apiKey() {
    return process.env.DIKRIPT_SECRET_KEY;
  }

  private verificationPath(endpoint: string) {
    const prefix = this.isTestMode()
      ? '/dikript/test/api/v1'
      : '/dikript/verification/api/v1';

    return `${prefix}/${endpoint}`;
  }

  private isMockMode() {
    return (process.env.DIKRIPT_MOCK_MODE || '').toLowerCase() === 'true';
  }

  private isTestMode() {
    return ['test', 'sandbox'].includes(
      (process.env.DIKRIPT_ENV || '').toLowerCase(),
    );
  }

  private useAdvancedBvn() {
    return (
      (process.env.DIKRIPT_BVN_ADVANCED || 'true').toLowerCase() !== 'false'
    );
  }

  private toProviderException(error: unknown) {
    if (error instanceof AxiosError) {
      this.logger.warn(
        `Dikript request failed with status ${
          error.response?.status || 'unknown'
        }`,
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

    this.logger.warn('Dikript request failed', error as Error);

    return new BadGatewayException(
      'Verification service is temporarily unavailable. Please try again later.',
    );
  }

  private mapNubanResponse(
    response: DikriptEnvelope,
    input: {
      firstName: string;
      lastName: string;
      accountNumber: string;
      bankCode: string;
      dateOfBirth?: string | null;
      phone?: string | null;
    },
  ): DikriptNubanResponse {
    const data = this.asRecord(response.data);
    const accountName = this.readString(data, 'name', 'accountName');
    const nameParts = this.splitName(accountName);

    return {
      id: response.transactionRef || this.generateMockId('nuban'),
      provider: 'DIKRIPT',
      raw: response,
      applicant: {
        firstname: input.firstName,
        lastname: input.lastName,
        accountNumber: input.accountNumber,
        bankCode: input.bankCode,
      },
      summary: {
        nuban_check: {
          status: response.status && accountName ? 'EXACT_MATCH' : 'NO_MATCH',
        },
      },
      status: {
        status: response.status ? 'verified' : 'failed',
      },
      nuban: {
        firstname: nameParts.firstName,
        lastname: nameParts.lastName,
        accountName: accountName || undefined,
        accountNumber:
          this.readString(data, 'accountNumber') || input.accountNumber,
        bankName: this.readString(data, 'bankName') || undefined,
        dob: input.dateOfBirth || undefined,
        mobileNumber: input.phone || undefined,
        accountCurrency: 'NGN',
      },
    };
  }

  private mapIdentityResponse(
    kind: 'nin' | 'bvn' | 'phone' | 'virtual-nin' | 'passport',
    identifier: string,
    response: DikriptEnvelope,
    fallback: {
      firstName: string;
      lastName: string;
      middleName?: string | null;
      dateOfBirth?: string | null;
      phone?: string | null;
      email?: string | null;
      gender?: string | null;
    },
  ): DikriptNinResponse {
    const data = this.asRecord(response.data);
    const isSuccessful = Boolean(
      response.status && Object.keys(data).length > 0,
    );
    const record = this.mapIdentityRecord(kind, identifier, data, fallback);
    const payload: DikriptNinResponse = {
      id: response.transactionRef || this.generateMockId(kind),
      provider: 'DIKRIPT',
      raw: response,
      status: {
        status: isSuccessful ? 'verified' : 'failed',
      },
      summary: {
        identity_check: isSuccessful ? 'EXACT_MATCH' : 'NO_MATCH',
      },
      insight: [],
    };

    if (kind === 'bvn') {
      payload.bvn = record;
    } else if (kind === 'phone') {
      payload.phone = record;
    } else if (kind === 'virtual-nin') {
      payload.virtual_nin = record;
    } else if (kind === 'passport') {
      payload.passport = {
        ...record,
        passportNo: identifier,
        issuedAt: this.readString(data, 'issuedAt', 'issuedDate'),
        issuedDate: this.readString(data, 'issuedDate'),
        expiryDate: this.readString(data, 'expiryDate'),
      };
    } else {
      payload.nin = record;
    }

    return payload;
  }

  private mapIdentityRecord(
    kind: 'nin' | 'bvn' | 'phone' | 'virtual-nin' | 'passport',
    identifier: string,
    data: DikriptIdentityPayload,
    fallback: {
      firstName: string;
      lastName: string;
      middleName?: string | null;
      dateOfBirth?: string | null;
      phone?: string | null;
      gender?: string | null;
    },
  ): DikriptIdentityRecord {
    const phoneNumber =
      this.readString(
        data,
        'phoneNumber',
        'phoneNumber1',
        'telephoneNo',
        'phone',
      ) ||
      fallback.phone ||
      undefined;
    const record: DikriptIdentityRecord = {
      firstname:
        this.readString(data, 'firstName', 'firstname') || fallback.firstName,
      lastname:
        this.readString(data, 'lastName', 'surname', 'lastname') ||
        fallback.lastName,
      middlename:
        this.readString(data, 'middleName', 'otherName', 'middlename') ||
        fallback.middleName ||
        undefined,
      gender: this.readString(data, 'gender') || fallback.gender || undefined,
      birthdate:
        this.readString(
          data,
          'dateOfBirth',
          'birthDate',
          'dateOfBirthLabel',
          'birthdate',
        ) ||
        fallback.dateOfBirth ||
        undefined,
      phone: phoneNumber,
      phoneNumber,
      address:
        this.readString(
          data,
          'residentialAddress',
          'residenceAddressLine1',
          'residenceAdressLine1',
          'address',
        ) || undefined,
    };

    if (kind === 'bvn') {
      record.bvn = this.readString(data, 'bvn') || identifier;
      record.nin = this.readString(data, 'nin') || undefined;
    } else if (kind === 'phone') {
      record.phoneNumber = this.readString(data, 'phoneNumber') || identifier;
      record.phone = record.phoneNumber;
    } else if (kind === 'passport') {
      record.passportNo =
        this.readString(data, 'passportNumber', 'number') || identifier;
    } else if (kind === 'virtual-nin') {
      record.nin = this.readString(data, 'nin') || undefined;
    } else {
      record.nin = this.readString(data, 'nin') || identifier;
    }

    return record;
  }

  private mapCacResponse(
    response: DikriptEnvelope,
    regNumber: string,
  ): DikriptCacResponse {
    const data = this.asRecord(response.data);
    const activeValue = data.active;
    const active =
      activeValue === true ? true : activeValue === false ? false : null;
    const companyName = this.readString(data, 'companyName');

    return {
      id: response.transactionRef || this.generateMockId('cac'),
      provider: 'DIKRIPT',
      raw: response,
      summary: {
        cac_check:
          response.status && companyName
            ? active === false
              ? 'rejected'
              : 'verified'
            : 'rejected',
      },
      status: {
        status: response.status && companyName ? 'verified' : 'failed',
      },
      cac: {
        rcNumber: this.readString(data, 'rcNumber') || regNumber,
        companyName,
        companyType: this.readString(data, 'companyType', 'classification'),
        registrationDate: this.readString(data, 'registrationDate'),
        branchAddress: this.readString(data, 'branchAddress'),
        companyEmail: this.readString(data, 'registrationEmail'),
        city: this.readString(data, 'city'),
        headOfficeAddress: this.readString(
          data,
          'headOfficeAddress',
          'address',
        ),
        lga: this.readString(data, 'lga'),
        state: this.readString(data, 'state'),
        status: active === false ? 'INACTIVE' : 'ACTIVE',
      },
    };
  }

  private mapCacAdvancedResponse(
    response: DikriptEnvelope,
    regNumber: string,
  ): DikriptCacResponse {
    const data = this.asRecord(response.data);
    const cac = this.asRecord(data.cac);
    const companyName = this.readString(cac, 'companyName');
    const registrationStatus = this.readString(cac, 'status');
    const isInactive = registrationStatus?.toUpperCase() === 'INACTIVE';
    const affiliatesData = Array.isArray(cac.affiliatesData)
      ? cac.affiliatesData
          .map((entry) => {
            const affiliate = this.asRecord(entry);
            const affiliateType = this.asRecord(affiliate.affiliateType);

            return {
              surname: this.readString(affiliate, 'surname'),
              firstname: this.readString(affiliate, 'firstname'),
              othername: this.readString(affiliate, 'othername'),
              status: this.readString(affiliate, 'status'),
              affiliateType: {
                name: this.readString(affiliateType, 'name'),
              },
            };
          })
          .filter(
            (entry) =>
              entry.firstname ||
              entry.surname ||
              entry.othername ||
              entry.affiliateType?.name,
          )
      : [];

    return {
      id: response.transactionRef || this.generateMockId('cac'),
      provider: 'DIKRIPT',
      raw: response,
      summary: {
        cac_check:
          response.status && companyName && !isInactive
            ? 'verified'
            : 'rejected',
      },
      status: {
        status:
          response.status && companyName && !isInactive ? 'verified' : 'failed',
      },
      cac: {
        rcNumber: this.readString(cac, 'rcNumber') || regNumber,
        companyName,
        companyType: this.readString(cac, 'companyType', 'classification'),
        registrationDate: this.readString(cac, 'registrationDate'),
        branchAddress: this.readString(cac, 'branchAddress'),
        companyEmail: this.readString(cac, 'companyEmail'),
        city: this.readString(cac, 'city'),
        headOfficeAddress: this.readString(cac, 'headOfficeAddress', 'address'),
        lga: this.readString(cac, 'lga'),
        state: this.readString(cac, 'state'),
        status: registrationStatus,
        affiliates: this.readString(cac, 'affiliates'),
        affiliatesData,
      },
    };
  }

  private mapFaceVerificationResponse(
    response: DikriptEnvelope,
  ): DikriptFaceVerificationResponse {
    const data = this.asRecord(response.data);
    const detail = this.asRecord(data.detail);
    const thresholds = this.asRecord(detail.thresholds);
    const confidence =
      this.readNumber(data, 'confidence') ||
      this.readNumber(detail, 'confidence') ||
      0;
    const isMatch = this.readBoolean(data, 'isMatch') === true;

    return {
      id: response.transactionRef || this.generateMockId('face'),
      provider: 'DIKRIPT',
      raw: response,
      status: {
        status: response.status && isMatch ? 'verified' : 'failed',
      },
      summary: {
        face_verification_check: {
          match: isMatch,
          match_score: confidence,
          matching_threshold: this.readThreshold(thresholds),
          max_score: 100,
        },
      },
      face_verification: {},
    };
  }

  private mapLivenessResponse(
    response: DikriptEnvelope,
  ): DikriptFaceVerificationResponse {
    const data = this.asRecord(response.data);
    const detail = this.asRecord(data.detail);
    const liveness = this.asRecord(detail.liveness);
    const confidence =
      this.readNumber(data, 'confidence') ||
      this.readNumber(liveness, 'livenessProbability') ||
      0;
    const isLively =
      this.readBoolean(data, 'isLively') === true ||
      this.readBoolean(liveness, 'livenessCheck') === true;

    return {
      id: response.transactionRef || this.generateMockId('liveness'),
      provider: 'DIKRIPT',
      raw: response,
      status: {
        status: response.status && isLively ? 'verified' : 'failed',
      },
      summary: {
        face_verification_check: {
          match: isLively,
          match_score: confidence,
          matching_threshold: null,
          max_score: 100,
        },
      },
      face_verification: {},
    };
  }

  private readThreshold(thresholds?: Record<string, unknown>) {
    if (!thresholds || typeof thresholds !== 'object') {
      return null;
    }

    const numericThresholds = Object.values(thresholds)
      .map(Number)
      .filter((value) => Number.isFinite(value));

    return numericThresholds.length ? Math.min(...numericThresholds) : null;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private readString(data: Record<string, unknown>, ...keys: string[]) {
    for (const key of keys) {
      const value = data[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }

      if (
        (typeof value === 'number' || typeof value === 'boolean') &&
        String(value).trim()
      ) {
        return String(value).trim();
      }
    }

    return undefined;
  }

  private readNumber(data: Record<string, unknown>, key: string) {
    const value = data[key];
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private readBoolean(data: Record<string, unknown>, key: string) {
    const value = data[key];
    return typeof value === 'boolean' ? value : null;
  }

  private splitName(value?: string | null) {
    const parts = (value || '').trim().split(/\s+/).filter(Boolean);

    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(' ') || undefined,
    };
  }

  private stripDataUri(value: string) {
    const marker = ';base64,';
    const index = value.indexOf(marker);
    return index >= 0 ? value.slice(index + marker.length) : value;
  }

  private buildMockNubanResponse(input: {
    firstName: string;
    lastName: string;
    accountNumber: string;
    bankCode: string;
    dateOfBirth?: string | null;
    phone?: string | null;
  }): DikriptNubanResponse {
    const scenario = this.resolveMockScenario(
      input.accountNumber,
      input.bankCode,
    );
    const accountName = `${input.firstName} ${input.lastName}`
      .trim()
      .toUpperCase();

    return {
      id: this.generateMockId('nuban'),
      provider: 'DIKRIPT',
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
    type: 'nin' | 'nin-phone' | 'bvn' | 'phone' | 'virtual-nin' | 'passport',
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
  ): DikriptNinResponse {
    const scenario = this.resolveMockScenario(
      identifier,
      input.phone,
      input.email,
    );
    const payload: DikriptNinResponse = {
      id: this.generateMockId(type),
      provider: 'DIKRIPT',
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
      phoneNumber: input.phone || undefined,
      gender: input.gender || undefined,
      birthdate: input.dateOfBirth || undefined,
    };

    if (type === 'bvn') {
      payload.bvn = { ...record, bvn: identifier, nin: '00000000000' };
    } else if (type === 'phone') {
      payload.phone = { ...record, phone: identifier, phoneNumber: identifier };
    } else if (type === 'virtual-nin') {
      payload.virtual_nin = { ...record, nin: identifier };
    } else if (type === 'passport') {
      payload.passport = {
        ...record,
        passportNo: identifier,
        issuedAt: '2025-01-01',
        expiryDate: '2030-01-01',
      };
    } else if (type === 'nin-phone') {
      payload.nin = { ...record, nin: '00000000000', phoneNumber: identifier };
    } else {
      payload.nin = { ...record, nin: identifier };
    }

    return payload;
  }

  private buildMockCacResponse(
    regNumber: string,
    includeAffiliates = false,
  ): DikriptCacResponse {
    const scenario = this.resolveMockScenario(regNumber);

    return {
      id: this.generateMockId('cac'),
      provider: 'DIKRIPT',
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
        affiliatesData: includeAffiliates
          ? [
              {
                firstname: 'Mock',
                surname: 'Director',
                status: 'ACTIVE',
                affiliateType: { name: 'DIRECTOR' },
              },
            ]
          : undefined,
      },
    };
  }

  private buildMockFaceVerificationResponse(input: {
    idType: DikriptFaceVerificationIdType;
    idNumber: string;
    photoUrl?: string | null;
    photoBase64?: string | null;
  }): DikriptFaceVerificationResponse {
    const scenario = this.resolveMockScenario(input.idNumber);

    return {
      id: this.generateMockId('face'),
      provider: 'DIKRIPT',
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
          match_score:
            scenario === 'verified' ? 97 : scenario === 'pending' ? 0 : 21,
          matching_threshold: 75,
          max_score: 100,
        },
      },
      face_verification: {
        photo:
          input.photoUrl ||
          (input.photoBase64 ? 'mock-base64-image' : undefined),
      },
    };
  }

  private buildMockLivenessResponse(input: {
    photoUrl?: string | null;
    photoBase64?: string | null;
  }): DikriptFaceVerificationResponse {
    const scenario = this.resolveMockScenario(
      input.photoUrl,
      input.photoBase64,
    );
    const isMatch = scenario !== 'failed';

    return {
      id: this.generateMockId('liveness'),
      provider: 'DIKRIPT',
      status: {
        status:
          scenario === 'pending' ? 'pending' : isMatch ? 'verified' : 'failed',
      },
      summary: {
        face_verification_check: {
          match: isMatch,
          match_score: isMatch ? 100 : 0,
          matching_threshold: null,
          max_score: 100,
        },
      },
      face_verification: {},
    };
  }

  private buildMockBanks(): DikriptBank[] {
    return [
      {
        name: 'Access Bank',
        code: '044',
        longcode: '044150149',
        country: 'NG',
      },
      { name: 'First Bank', code: '011', longcode: '011151003', country: 'NG' },
      { name: 'GTBank', code: '058', longcode: '058152036', country: 'NG' },
      { name: 'Opay', code: '999992', longcode: '999992', country: 'NG' },
      { name: 'PalmPay', code: '999991', longcode: '999991', country: 'NG' },
      {
        name: 'Sterling Bank',
        code: '232',
        longcode: '232150016',
        country: 'NG',
      },
      { name: 'UBA', code: '033', longcode: '033153513', country: 'NG' },
      { name: 'Union Bank', code: '032', longcode: '032080474', country: 'NG' },
      { name: 'Wema Bank', code: '035', longcode: '035150103', country: 'NG' },
      {
        name: 'Zenith Bank',
        code: '057',
        longcode: '057150013',
        country: 'NG',
      },
    ];
  }

  private resolveMockScenario(...values: Array<string | null | undefined>) {
    const normalized = values.filter(Boolean).join(' ').toLowerCase();

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
    return `dikript-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
}
