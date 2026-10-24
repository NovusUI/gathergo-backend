import type { BadgeDefinition, BadgeMetric } from './badge.catalog';

export type BadgeContribution = { at: Date; amount: number };
export type BadgeActivity = Record<BadgeMetric, BadgeContribution[]>;
export type BadgeStatus = 'locked' | 'in_progress' | 'earned';

export function badgeProgress(badge: BadgeDefinition, activity: BadgeActivity) {
  const contributions = [...activity[badge.metric]].sort(
    (left, right) => left.at.getTime() - right.at.getTime(),
  );
  let total = 0;
  let earnedAt: Date | null = null;
  for (const contribution of contributions) {
    total += contribution.amount;
    if (earnedAt === null && total >= badge.target) earnedAt = contribution.at;
  }
  const current = Math.min(total, badge.target);
  const remaining = badge.target - current;
  const status: BadgeStatus =
    earnedAt !== null ? 'earned' : current > 0 ? 'in_progress' : 'locked';
  const progressLabel =
    badge.unit === 'minutes'
      ? `${Math.floor(current / 60)}h ${current % 60}m / 10h`
      : `${current} / ${badge.target} ${badge.target === 1 ? badge.unit.slice(0, -1) : badge.unit}`;
  const nextStep =
    earnedAt !== null
      ? `You earned ${badge.name}. Thank you for being part of GatherGo!`
      : badge.metric === 'volunteerMinutes'
        ? `${Math.floor(remaining / 60)}h ${remaining % 60}m of organiser-confirmed volunteering to go. Every bit of time matters.`
        : badge.metric === 'attendance'
          ? `Check in to ${remaining} more ${remaining === 1 ? 'event' : 'events'} to earn ${badge.name}. I’ll keep track as you go!`
          : badge.metric === 'volunteerEvents'
            ? 'Lend a hand at a volunteer event, then ask the organiser to confirm your contribution.'
            : badge.metric === 'hostedEvents'
              ? 'Bring people together. Once your event ends with another person checked in, you’ve earned Gather Maker.'
              : badge.metric === 'impactReports'
                ? 'After your event ends, share its impact report from your event dashboard.'
                : badge.metric === 'donationMonths'
                  ? `Give in ${remaining} more ${remaining === 1 ? 'calendar month' : 'calendar months'}. There’s no rush, and the months don’t need to be consecutive.`
                  : badge.metric === 'donatedEvents'
                    ? `Support ${remaining} more ${remaining === 1 ? 'event or fundraiser' : 'events or fundraisers'}. Any accepted donation amount counts.`
                    : 'Find a fundraiser you care about. Your first successful donation earns First Gift.';
  return {
    status,
    earnedAt,
    progress: {
      current,
      target: badge.target,
      remaining,
      percent: Math.floor((current / badge.target) * 100),
      unit: badge.unit,
      label: progressLabel,
    },
    gogo: { message: nextStep },
  };
}
