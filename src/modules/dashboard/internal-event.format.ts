import {
  summarizeVolunteering,
  volunteerEventMetrics,
} from '../volunteer/volunteer.util';
import type { InternalEventData } from './internal-event.types';

export function formatInternalEvent(event: InternalEventData, now: Date) {
  const volunteering = summarizeVolunteering(event);
  let participants = 0,
    grossAmount = 0,
    goalAmount = 0;
  switch (event.registrationType) {
    case 'ticket':
      participants = event.eventTickets.reduce(
        (total, ticket) => total + ticket.sold,
        0,
      );
      grossAmount = event.eventTickets.reduce(
        (total, ticket) => total + ticket.sold * ticket.price,
        0,
      );
      goalAmount = event.eventTickets.reduce(
        (total, ticket) => total + ticket.quantity * ticket.price,
        0,
      );
      break;
    case 'registration':
      participants = event.Registration.length;
      grossAmount = participants * (event.registrationFee ?? 0);
      goalAmount =
        (event.registrationAttendees ?? 0) * (event.registrationFee ?? 0);
      break;
    case 'donation': {
      const completed = event.donations.filter(
        (donation) => donation.status === 'completed',
      );
      participants = completed.length;
      grossAmount =
        completed.reduce((total, donation) => total + donation.amount, 0) / 100;
      goalAmount = (event.donationTarget ?? 0) / 100;
      break;
    }
    case 'volunteer': {
      const metrics = volunteerEventMetrics(event);
      participants = metrics.participants;
      grossAmount = metrics.raised;
      goalAmount = metrics.goal;
      break;
    }
  }
  const status =
    event.endDate < now
      ? 'ENDED'
      : event.startDate <= now
        ? 'LIVE'
        : 'UPCOMING';
  return {
    id: event.id,
    title: event.title,
    registrationType: event.registrationType,
    location: event.location,
    startDate: event.startDate,
    endDate: event.endDate,
    status,
    participants,
    grossAmount,
    goalAmount,
    progress:
      goalAmount > 0
        ? Math.min(Math.round((grossAmount / goalAmount) * 100), 100)
        : 0,
    volunteering,
    creator: event.creator,
  };
}
