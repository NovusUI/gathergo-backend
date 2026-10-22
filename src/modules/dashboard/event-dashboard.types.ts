import { Prisma } from '@prisma/client';
import { volunteerSummaryInclude } from '../volunteer/volunteer.util';

export const eventDashboardInclude = {
  ...volunteerSummaryInclude,
  eventTickets: { select: { sold: true, quantity: true, price: true } },
  donations: { select: { amount: true, status: true } },
  Registration: { select: { id: true } },
} satisfies Prisma.EventInclude;

export type EventDashboardData = Prisma.EventGetPayload<{
  include: typeof eventDashboardInclude;
}>;
