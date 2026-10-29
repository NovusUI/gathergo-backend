import type { Event, MealPass } from '@prisma/client';

export type CollectionEvent = Pick<
  Event,
  'startDate' | 'endDate' | 'foodBankCollectionStatus' | 'foodBankTimeZone'
>;
export type CollectionAvailability =
  | 'upcoming'
  | 'not_started'
  | 'open'
  | 'paused'
  | 'closed'
  | 'ended';
export type MealCollectionDetails = Pick<
  MealPass,
  'collectionStart' | 'collectionEnd'
> & {
  status: Exclude<CollectionAvailability, 'open'> | 'ready' | 'collected';
  arrival: 'early' | 'on_time' | 'late';
  timeZone: string;
};

export function collectionLocalDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  // Intl includes each explicitly requested date part.
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}

export function collectionAvailability(
  event: CollectionEvent,
  now: Date,
): CollectionAvailability {
  const today = collectionLocalDay(now, event.foodBankTimeZone);
  if (today < collectionLocalDay(event.startDate, event.foodBankTimeZone))
    return 'upcoming';
  if (today > collectionLocalDay(event.endDate, event.foodBankTimeZone))
    return 'ended';
  const states = {
    NOT_STARTED: 'not_started',
    OPEN: 'open',
    PAUSED: 'paused',
    CLOSED: 'closed',
  } as const;
  return states[event.foodBankCollectionStatus];
}

export function mealCollectionDetails(
  pass: Pick<MealPass, 'collectionStart' | 'collectionEnd' | 'isUsed'> & {
    event: CollectionEvent;
  },
  now: Date,
): MealCollectionDetails {
  const availability = collectionAvailability(pass.event, now);
  return {
    collectionStart: pass.collectionStart,
    collectionEnd: pass.collectionEnd,
    status: pass.isUsed
      ? 'collected'
      : availability === 'open'
        ? 'ready'
        : availability,
    arrival:
      now < pass.collectionStart
        ? 'early'
        : now >= pass.collectionEnd
          ? 'late'
          : 'on_time',
    timeZone: pass.event.foodBankTimeZone,
  };
}

export const MEAL_COLLECTION_MESSAGES: Record<
  MealCollectionDetails['status'],
  string
> = {
  upcoming: 'Collection is not available before the collection day.',
  not_started: 'The organiser has not opened collection yet.',
  paused: 'Collection is paused. Please wait for the organiser to resume.',
  closed: 'The organiser has closed collection.',
  ended: 'The collection day has ended. Please speak with the organiser.',
  ready: 'Ready for collection',
  collected: 'This meal has already been collected.',
};
