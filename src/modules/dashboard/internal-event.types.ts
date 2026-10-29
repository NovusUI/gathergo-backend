import { Prisma } from '@prisma/client';
import { volunteerSummaryInclude } from '../volunteer/volunteer.util';

export const internalEventSelect = {
  id: true,
  title: true,
  registrationType: true,
  location: true,
  startDate: true,
  endDate: true,
  donationTarget: true,
  registrationAttendees: true,
  registrationFee: true,
  ...volunteerSummaryInclude,
  creator: {
    select: { id: true, username: true, fullName: true, email: true },
  },
  eventTickets: { select: { sold: true, quantity: true, price: true } },
  donations: { select: { amount: true, status: true } },
  Registration: { select: { id: true } },
} satisfies Prisma.EventSelect;
export type InternalEventData = Prisma.EventGetPayload<{
  select: typeof internalEventSelect;
}>;
export const internalEventDetailSelect = {
  ...internalEventSelect,
  description: true,
  isPhysicalEvent: true,
  links: true,
  tags: true,
  updatedAt: true,
} satisfies Prisma.EventSelect;
export type InternalEventDetailData = Prisma.EventGetPayload<{
  select: typeof internalEventDetailSelect;
}>;
