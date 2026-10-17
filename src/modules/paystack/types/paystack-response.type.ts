export type PaystackResponse = {
  status: boolean;
  message: string;
  data: any;
};

export type PaystackBank = {
  id: number;
  name: string;
  slug: string;
  code: string;
  longcode: string;
  gateway: string | null;
  pay_with_bank: boolean;
  active: boolean;
  country: string;
  currency: string;
  type: string;
  is_deleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PaystackBanksResponse = {
  status: boolean;
  message: string;
  data: PaystackBank[];
};

export type PaystackResolvedAccount = {
  account_number: string;
  account_name: string;
};

export type PaystackResolveAccountResponse = {
  status: boolean;
  message: string;
  data: PaystackResolvedAccount;
};
