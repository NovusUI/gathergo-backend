import { BADGE_CATALOG } from './badge.catalog';
import { BadgeActivity, badgeProgress } from './badge-progress';

export const emptyActivity = (): BadgeActivity => ({
  attendance: [],
  volunteerEvents: [],
  volunteerMinutes: [],
  hostedEvents: [],
  impactReports: [],
  donations: [],
  donatedEvents: [],
  donationMonths: [],
});

describe('badge progress and Gogo guidance', () => {
  it('shows exact requirements and zero progress for all nine starter badges', () => {
    expect(BADGE_CATALOG).toHaveLength(9);
    for (const badge of BADGE_CATALOG) {
      const result = badgeProgress(badge, emptyActivity());
      expect(result).toMatchObject({
        status: 'locked',
        earnedAt: null,
        progress: { current: 0, remaining: badge.target, percent: 0 },
      });
      expect(badge.requirement.length).toBeGreaterThan(20);
      expect(result.gogo.message.length).toBeGreaterThan(20);
    }
  });

  it('shows progress, the remaining events, and the real threshold date', () => {
    const badge = BADGE_CATALOG.find((item) => item.code === 'FAMILIAR_FACE')!;
    const activity = emptyActivity();
    activity.attendance = [1, 2, 3].map((day) => ({
      at: new Date(`2026-01-0${day}`),
      amount: 1,
    }));
    expect(badgeProgress(badge, activity)).toMatchObject({
      status: 'in_progress',
      progress: { current: 3, target: 5, remaining: 2, percent: 60 },
    });
    expect(badgeProgress(badge, activity).gogo.message).toContain(
      '2 more events',
    );
    activity.attendance.push(
      { at: new Date('2026-01-06'), amount: 1 },
      { at: new Date('2026-01-05'), amount: 1 },
      { at: new Date('2026-01-04'), amount: 1 },
    );
    expect(badgeProgress(badge, activity)).toMatchObject({
      status: 'earned',
      earnedAt: new Date('2026-01-05'),
      progress: { current: 5, remaining: 0, percent: 100 },
    });
  });

  it('does not round partial volunteer hours into an earned badge', () => {
    const badge = BADGE_CATALOG.find((item) => item.code === 'TIME_GIVER')!;
    const activity = emptyActivity();
    activity.volunteerMinutes = [{ at: new Date('2026-01-01'), amount: 599 }];
    expect(badgeProgress(badge, activity)).toMatchObject({
      status: 'in_progress',
      progress: {
        current: 599,
        target: 600,
        remaining: 1,
        percent: 99,
        label: '9h 59m / 10h',
      },
    });
    activity.volunteerMinutes.push({ at: new Date('2026-01-02'), amount: 60 });
    expect(badgeProgress(badge, activity)).toMatchObject({
      status: 'earned',
      earnedAt: new Date('2026-01-02'),
      progress: { label: '10h 0m / 10h', percent: 100 },
    });
  });
});
