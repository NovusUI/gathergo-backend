import { BadRequestException } from '@nestjs/common';
import { Donation, Event, Prisma, VolunteerStatus } from '@prisma/client';

export const occupiedVolunteerStatuses = [
  VolunteerStatus.ACCEPTED,
  VolunteerStatus.CHECKED_IN,
  VolunteerStatus.COMPLETED,
];

export const volunteerSummaryInclude = {
  volunteerRoles: { select: { capacity: true } },
  volunteers: { select: { status: true, confirmedMinutes: true } },
} satisfies Prisma.EventInclude;

type VolunteerSummaryEvent = Pick<
  Prisma.EventGetPayload<{
    include: typeof volunteerSummaryInclude;
  }>,
  'volunteerRoles' | 'volunteers'
>;

export function summarizeVolunteering(event: VolunteerSummaryEvent) {
  const counts = {
    APPLIED: 0,
    ACCEPTED: 0,
    DECLINED: 0,
    WITHDRAWN: 0,
    CHECKED_IN: 0,
    COMPLETED: 0,
  } satisfies Record<VolunteerStatus, number>;
  let confirmedMinutes = 0;
  for (const volunteer of event.volunteers) {
    counts[volunteer.status] += 1;
    if (volunteer.status === VolunteerStatus.COMPLETED) {
      confirmedMinutes += volunteer.confirmedMinutes ?? 0;
    }
  }
  const capacity = event.volunteerRoles.reduce(
    (total, role) => total + role.capacity,
    0,
  );
  const confirmedPlaces =
    counts.ACCEPTED + counts.CHECKED_IN + counts.COMPLETED;
  return {
    counts,
    capacity,
    confirmedPlaces,
    attended: counts.CHECKED_IN + counts.COMPLETED,
    confirmedMinutes,
    confirmedHours: confirmedMinutes / 60,
    recruitmentProgress:
      capacity > 0 ? Math.round((confirmedPlaces / capacity) * 100) : 0,
  };
}

export function volunteerEventMetrics(
  event: VolunteerSummaryEvent &
    Pick<Event, 'donationTarget'> & {
      donations: Pick<Donation, 'amount' | 'status'>[];
    },
) {
  const volunteering = summarizeVolunteering(event);
  const raised =
    event.donations
      .filter((donation) => donation.status === 'completed')
      .reduce((total, donation) => total + donation.amount, 0) / 100;
  const goal = (event.donationTarget ?? 0) / 100;
  return {
    volunteering,
    participants: volunteering.confirmedPlaces,
    raised,
    goal,
    progress: goal > 0 ? Math.min(Math.round((raised / goal) * 100), 100) : 0,
  };
}

export function assertVolunteerEvent<
  T extends Pick<Event, 'isPhysicalEvent' | 'impactDescription'>,
>(event: T) {
  if (!event.isPhysicalEvent) {
    throw new BadRequestException(
      'Volunteering is only available at physical events',
    );
  }
  if (!event.impactDescription?.trim()) {
    throw new BadRequestException(
      'Add an impact story before enabling volunteering',
    );
  }
}
