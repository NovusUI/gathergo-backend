import {
  collectionAvailability,
  collectionLocalDay,
  mealCollectionDetails,
} from './collection-policy';
import { FoodBankCollectionStatus } from '@prisma/client';

const event = {
  startDate: new Date('2035-01-01T10:00:00Z'),
  endDate: new Date('2035-01-01T20:00:00Z'),
  foodBankCollectionStatus: FoodBankCollectionStatus.OPEN,
  foodBankTimeZone: 'Africa/Lagos',
};
const pass = {
  collectionStart: event.startDate,
  collectionEnd: new Date('2035-01-01T10:15:00Z'),
  isUsed: false,
  event,
};

describe('collection day and advisory arrival policy', () => {
  it('uses the saved timezone rather than the server timezone at midnight', () => {
    expect(
      collectionLocalDay(new Date('2034-12-31T23:00:00Z'), 'Africa/Lagos'),
    ).toBe('2035-01-01');
    expect(
      collectionAvailability(event, new Date('2034-12-31T22:59:59Z')),
    ).toBe('upcoming');
    expect(
      collectionAvailability(event, new Date('2034-12-31T23:00:00Z')),
    ).toBe('open');
    expect(
      collectionAvailability(event, new Date('2035-01-01T22:59:59Z')),
    ).toBe('open');
    expect(
      collectionAvailability(event, new Date('2035-01-01T23:00:00Z')),
    ).toBe('ended');
  });
  it('handles daylight saving time and overnight event ranges', () => {
    expect(
      collectionLocalDay(new Date('2035-07-01T03:59:59Z'), 'America/New_York'),
    ).toBe('2035-06-30');
    expect(
      collectionLocalDay(new Date('2035-07-01T04:00:00Z'), 'America/New_York'),
    ).toBe('2035-07-01');
    expect(
      collectionAvailability(
        { ...event, endDate: new Date('2035-01-02T01:00:00Z') },
        new Date('2035-01-02T19:00:00Z'),
      ),
    ).toBe('open');
  });
  it.each([
    ['2035-01-01T09:00:00Z', 'early'],
    ['2035-01-01T10:00:00Z', 'on_time'],
    ['2035-01-01T10:15:00Z', 'late'],
    ['2035-01-01T22:00:00Z', 'late'],
  ])('keeps arrival at %s advisory', (time, arrival) => {
    expect(mealCollectionDetails(pass, new Date(time))).toMatchObject({
      status: 'ready',
      arrival,
    });
  });
  it('never makes a collected pass usable again after reopening', () => {
    expect(
      mealCollectionDetails(
        { ...pass, isUsed: true },
        new Date('2035-01-01T15:00:00Z'),
      ).status,
    ).toBe('collected');
  });
});
