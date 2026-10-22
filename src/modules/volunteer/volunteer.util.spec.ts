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

  it.each(['ticket', 'registration', 'donation', 'volunteer'] as const)(
    'allows physical %s events with an impact story',
    (registrationType) => {
      expect(() =>
        assertVolunteerEvent({
          registrationType,
          isPhysicalEvent: true,
          impactTitle: 'Community impact',
          impactDescription: 'Help restore shared green spaces.',
        }),
      ).not.toThrow();
    },
  );

  it.each(['ticket', 'registration', 'donation', 'volunteer'] as const)(
    'requires an impact story for %s events even when they have an impact title',
    (registrationType) => {
      for (const impactDescription of [null, '', '   ']) {
        expect(() =>
          assertVolunteerEvent({
            registrationType,
            isPhysicalEvent: true,
            impactTitle: 'Community impact',
            impactDescription,
          }),
        ).toThrow('Add an impact story');
      }
    },
  );

  it('requires a physical event and an impact story', () => {
    expect(() =>
      assertVolunteerEvent({
        registrationType: 'volunteer',
        isPhysicalEvent: false,
        impactTitle: null,
        impactDescription: null,
      }),
    ).toThrow('physical');
    expect(() =>
      assertVolunteerEvent({
        registrationType: 'ticket',
        isPhysicalEvent: true,
        impactTitle: null,
        impactDescription: null,
      }),
    ).toThrow('impact');
  });
});
