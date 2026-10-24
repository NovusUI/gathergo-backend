import { BadgeCode } from '@prisma/client';

export type BadgeCategory = 'attending' | 'volunteering' | 'hosting' | 'giving';
export type BadgeMetric =
  | 'attendance'
  | 'volunteerEvents'
  | 'volunteerMinutes'
  | 'hostedEvents'
  | 'impactReports'
  | 'donations'
  | 'donatedEvents'
  | 'donationMonths';

export type BadgeDefinition = {
  code: BadgeCode;
  name: string;
  category: BadgeCategory;
  icon:
    | 'party'
    | 'sparkles'
    | 'handshake'
    | 'clock'
    | 'tent'
    | 'sprout'
    | 'gift'
    | 'heart';
  description: string;
  requirement: string;
  metric: BadgeMetric;
  target: number;
  unit: 'events' | 'roles' | 'minutes' | 'reports' | 'donations' | 'months';
};

export const BADGE_CATALOG: readonly BadgeDefinition[] = [
  {
    code: BadgeCode.FIRST_GATHER,
    name: 'First Gather',
    category: 'attending',
    icon: 'party',
    description: 'Your first hello in real life.',
    requirement:
      'Check in to 1 event. A ticket purchase or registration alone does not count.',
    metric: 'attendance',
    target: 1,
    unit: 'events',
  },
  {
    code: BadgeCode.FAMILIAR_FACE,
    name: 'Familiar Face',
    category: 'attending',
    icon: 'sparkles',
    description: 'Keep showing up for your community.',
    requirement:
      'Check in to 5 different events. Multiple tickets or roles at one event count once.',
    metric: 'attendance',
    target: 5,
    unit: 'events',
  },
  {
    code: BadgeCode.HELPING_HAND,
    name: 'Helping Hand',
    category: 'volunteering',
    icon: 'handshake',
    description: 'A little time can make a difference.',
    requirement:
      'Complete 1 volunteer role with positive contribution time confirmed by the organiser after the event.',
    metric: 'volunteerEvents',
    target: 1,
    unit: 'roles',
  },
  {
    code: BadgeCode.TIME_GIVER,
    name: 'Time Giver',
    category: 'volunteering',
    icon: 'clock',
    description: 'Ten hours of showing you care.',
    requirement:
      'Reach 10 volunteer hours confirmed by organisers. Applications and unconfirmed time do not count.',
    metric: 'volunteerMinutes',
    target: 600,
    unit: 'minutes',
  },
  {
    code: BadgeCode.GATHER_MAKER,
    name: 'Gather Maker',
    category: 'hosting',
    icon: 'tent',
    description: 'You brought people together.',
    requirement:
      'Host 1 event that has ended with at least 1 other person checked in, including volunteers.',
    metric: 'hostedEvents',
    target: 1,
    unit: 'events',
  },
  {
    code: BadgeCode.IMPACT_STORYTELLER,
    name: 'Impact Storyteller',
    category: 'hosting',
    icon: 'sprout',
    description: 'Share what your gathering made possible.',
    requirement:
      'Publish 1 impact report after your event ends. This recognises reporting, not independent verification of the claims.',
    metric: 'impactReports',
    target: 1,
    unit: 'reports',
  },
  {
    code: BadgeCode.FIRST_GIFT,
    name: 'First Gift',
    category: 'giving',
    icon: 'gift',
    description: 'Your first contribution to something that matters.',
    requirement:
      'Make 1 successful donation of any accepted amount. Pending, failed and refunded payments do not count.',
    metric: 'donations',
    target: 1,
    unit: 'donations',
  },
  {
    code: BadgeCode.COMMUNITY_BACKER,
    name: 'Community Backer',
    category: 'giving',
    icon: 'heart',
    description: 'Help more good things happen.',
    requirement:
      'Make successful donations to 3 different events or fundraisers. Any accepted amount qualifies.',
    metric: 'donatedEvents',
    target: 3,
    unit: 'events',
  },
  {
    code: BadgeCode.STEADY_GIVER,
    name: 'Steady Giver',
    category: 'giving',
    icon: 'sprout',
    description: 'Make giving part of your story.',
    requirement:
      'Make successful donations in 3 different calendar months, counted in Africa/Lagos time. The months do not need to be consecutive.',
    metric: 'donationMonths',
    target: 3,
    unit: 'months',
  },
];
