import { Prisma } from '@prisma/client';

export const creatorSelect = {
  id: true,
  fullName: true,
  username: true,
  email: true,
  createdAt: true,
  isVerified: true,
  _count: { select: { eventsCreated: true, followedBy: true } },
  settlementProfile: {
    select: {
      status: true,
      bankName: true,
      accountName: true,
      accountNumberMasked: true,
      legalName: true,
      businessName: true,
      accountOwnershipType: true,
      rejectionReason: true,
    },
  },
  kycVerification: {
    select: {
      status: true,
      provider: true,
      nameMatchStatus: true,
      reviewedAt: true,
      submittedAt: true,
      rejectionReason: true,
    },
  },
  alatProfile: {
    select: { status: true, displayName: true, reviewedAt: true },
  },
} satisfies Prisma.UserSelect;

export type CreatorDirectoryItem = Prisma.UserGetPayload<{
  select: typeof creatorSelect;
}>;

export const creatorDetailSelect = {
  ...creatorSelect,
  bio: true,
  phoneNumber: true,
} satisfies Prisma.UserSelect;
export type CreatorProfile = Prisma.UserGetPayload<{
  select: typeof creatorDetailSelect;
}>;

export const creatorEventSelect = {
  id: true,
  title: true,
  registrationType: true,
  location: true,
  startDate: true,
  endDate: true,
  createdAt: true,
} satisfies Prisma.EventSelect;
export type CreatorEvent = Prisma.EventGetPayload<{
  select: typeof creatorEventSelect;
}>;
