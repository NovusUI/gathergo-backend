import { VolunteerStatus } from '@prisma/client';
import {
  assertVolunteerEvent,
  summarizeVolunteering,
  volunteerEventMetrics,
} from './volunteer.util';

describe('volunteer participation metrics', () => {
  const event = {
    donationTarget: 500000,
    volunteerRoles: [{ capacity: 10 }],
    volunteers: [
      { status: VolunteerStatus.APPLIED, confirmedMinutes: null },
      { status: VolunteerStatus.ACCEPTED, confirmedMinutes: null },
      { status: VolunteerStatus.CHECKED_IN, confirmedMinutes: null },
      { status: VolunteerStatus.COMPLETED, confirmedMinutes: 90 },
      { status: VolunteerStatus.DECLINED, confirmedMinutes: null },
      { status: VolunteerStatus.WITHDRAWN, confirmedMinutes: null },
    ],
    donations: [
      { amount: 100000, status: 'completed' },
      { amount: 900000, status: 'pending' },
    ],
  };

  it('distinguishes applications, confirmed places, attendance and confirmed hours', () => {
    expect(summarizeVolunteering(event)).toMatchObject({
      capacity: 10,
      confirmedPlaces: 3,
      attended: 2,
      confirmedMinutes: 90,
      confirmedHours: 1.5,
      recruitmentProgress: 30,
      counts: {
        APPLIED: 1,
        ACCEPTED: 1,
        CHECKED_IN: 1,
        COMPLETED: 1,
        DECLINED: 1,
        WITHDRAWN: 1,
      },
    });
  });

  it('reports money in naira separately from volunteer recruitment and excludes incomplete donations', () => {
    expect(volunteerEventMetrics(event)).toMatchObject({
      participants: 3,
      raised: 1000,
      goal: 5000,
      progress: 20,
      volunteering: { recruitmentProgress: 30, confirmedHours: 1.5 },
    });
  });

  it('represents an event without fundraising or volunteering without inventing contributions', () => {
    expect(
      volunteerEventMetrics({
        donationTarget: null,
        volunteers: [],
        volunteerRoles: [],
        donations: [],
      }),
    ).toMatchObject({
      participants: 0,
      raised: 0,
      goal: 0,
      progress: 0,
      volunteering: { confirmedHours: 0, recruitmentProgress: 0 },
    });
  });

  it.each(['ticket', 'registration', 'donation'] as const)(
    'does not allow %s events to recruit volunteers even with a physical venue and story',
    (registrationType) => {
      expect(() =>
        assertVolunteerEvent({
          registrationType,
          isPhysicalEvent: true,
          impactDescription: 'Help restore shared green spaces.',
        }),
      ).toThrow('only available for Volunteer and donation events');
    },
  );

  it.each([false, true])(
    'allows volunteer events with donationsEnabled=%s',
    (donationsEnabled) => {
      expect(() =>
        assertVolunteerEvent({
          registrationType: 'volunteer',
          donationsEnabled,
          isPhysicalEvent: true,
          impactDescription: 'Help restore shared green spaces.',
        }),
      ).not.toThrow();
    },
  );

  it('requires a physical venue and an impact story for volunteer events', () => {
    expect(() =>
      assertVolunteerEvent({
        registrationType: 'volunteer',
        isPhysicalEvent: false,
        impactDescription: 'Help restore shared green spaces.',
      }),
    ).toThrow('physical');
    for (const impactDescription of [null, '', '   ']) {
      expect(() =>
        assertVolunteerEvent({
          registrationType: 'volunteer',
          isPhysicalEvent: true,
          impactDescription,
        }),
      ).toThrow('Add an impact story');
    }
  });
});
