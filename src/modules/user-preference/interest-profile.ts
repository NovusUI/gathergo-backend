import type { Event, Prisma } from '@prisma/client';

export const HELP_MODES = ['attend', 'volunteer', 'donate', 'carpool'] as const;
export const INTEREST_TOPICS = [
  {
    id: 'Nature',
    label: 'Environment',
    accent: '#60D394',
    tags: ['Nature', 'Outdoor', 'Environment', 'Adventure', 'Zoo'],
    goals: ['sdg_6', 'sdg_7', 'sdg_12', 'sdg_13', 'sdg_14', 'sdg_15'],
    paths: ['sustainable_mobility'],
  },
  {
    id: 'Education',
    label: 'Education',
    accent: '#31C6F6',
    tags: [
      'Education',
      'Learning',
      'STEM',
      'Scientific',
      'Career',
      'Leadership',
    ],
    goals: ['sdg_4'],
    paths: ['awareness_education'],
  },
  {
    id: 'Health',
    label: 'Health',
    accent: '#0FF1CF',
    tags: ['Health', 'Wellness', 'Mindfulness'],
    goals: ['sdg_3'],
    paths: ['health_action'],
  },
  {
    id: 'Community',
    label: 'Community',
    accent: '#FF8A59',
    tags: ['Community', 'Family', 'Volunteering', 'Inclusion'],
    goals: ['sdg_1', 'sdg_5', 'sdg_10', 'sdg_11', 'sdg_16', 'sdg_17'],
    paths: ['direct_action', 'resource_collection', 'access_inclusion'],
  },
  {
    id: 'Music',
    label: 'Music',
    accent: '#FF6B6B',
    tags: ['Music', 'Concert', 'Nightlife', 'Dance', 'Festival'],
    goals: [],
    paths: [],
  },
  {
    id: 'Culture',
    label: 'Arts & culture',
    accent: '#F8D05C',
    tags: [
      'Culture',
      'Art',
      'Cinema',
      'Museum',
      'Photography',
      'Design',
      'History',
      'Crafts',
      'Fashion',
      'Beauty',
      'Pop Culture',
    ],
    goals: [],
    paths: ['creative_platform'],
  },
  {
    id: 'Food',
    label: 'Food & connection',
    accent: '#F4A261',
    tags: ['Food', 'Brunches', 'Lifestyle'],
    goals: ['sdg_2'],
    paths: [],
  },
  {
    id: 'Tech',
    label: 'Tech & business',
    accent: '#B78CFF',
    tags: [
      'Tech',
      'AI',
      'Gaming',
      'Business',
      'Startup',
      'Innovation',
      'Networking',
      'Finance',
      'Realstate',
      'Architecture',
    ],
    goals: ['sdg_8', 'sdg_9'],
    paths: [],
  },
  {
    id: 'Fitness',
    label: 'Sport & adventure',
    accent: '#7DD3FC',
    tags: ['Fitness', 'Sport', 'Travel'],
    goals: [],
    paths: [],
  },
];
export const preferenceEventSelect = {
  id: true,
  title: true,
  description: true,
  location: true,
  startDate: true,
  thumbnailUrl: true,
  registrationType: true,
  tags: true,
  impactSdgGoals: true,
  impactPaths: true,
} satisfies Prisma.EventSelect;
export type ProfileSignal = {
  event: Pick<
    Event,
    'tags' | 'impactSdgGoals' | 'impactPaths' | 'registrationType'
  >;
  kind:
    | 'LIKE'
    | 'VIEW'
    | 'ATTEND'
    | 'VOLUNTEER'
    | 'DONATE'
    | 'LOVED'
    | 'OKAY'
    | 'NOT_FOR_ME'
    | 'MORE_LIKE_THIS';
  createdAt: Date;
};
export type InterestWeight = {
  id: string;
  label: string;
  accent: string;
  weight: number;
  source: 'chosen' | 'activity' | 'both';
};
export type InterestProfile = {
  interests: string[];
  helpModes: string[];
  city: string | null;
  learningEnabled: boolean;
  weights: InterestWeight[];
};

export function chosenTopics(interests: string[]): string[] {
  const tags = new Set(interests.map((value) => value.toLowerCase()));
  return INTEREST_TOPICS.filter((topic) =>
    topic.tags.some((tag) => tags.has(tag.toLowerCase())),
  ).map((topic) => topic.id);
}
function impactIds(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof item.id === 'string'
          ? [item.id]
          : [],
      )
    : [];
}
export function eventTopics(
  event: Pick<Event, 'tags' | 'impactSdgGoals' | 'impactPaths'>,
): string[] {
  const tags = new Set(event.tags.map((tag) => tag.toLowerCase()));
  const goals = impactIds(event.impactSdgGoals);
  const paths = impactIds(event.impactPaths);
  return INTEREST_TOPICS.filter(
    (topic) =>
      topic.tags.some((tag) => tags.has(tag.toLowerCase())) ||
      topic.goals.some((goal) => goals.includes(goal)) ||
      topic.paths.some((path) => paths.includes(path)),
  ).map((topic) => topic.id);
}
const SIGNAL_STRENGTH: Record<ProfileSignal['kind'], number> = {
  LIKE: 1.5,
  VIEW: 0.15,
  ATTEND: 2,
  VOLUNTEER: 2,
  DONATE: 2,
  LOVED: 2,
  OKAY: 0.5,
  NOT_FOR_ME: -1.5,
  MORE_LIKE_THIS: 1,
};
const AFFINITY_STRENGTH = {
  ...SIGNAL_STRENGTH,
  ATTEND: 1.5,
  VOLUNTEER: 1.5,
  DONATE: 1.5,
};

export function interestWeightChanges(
  before: InterestWeight[],
  after: InterestWeight[],
) {
  return INTEREST_TOPICS.flatMap(({ id }) => {
    const previous = before.find((item) => item.id === id);
    const next = after.find((item) => item.id === id);
    const base = next ?? previous;
    const previousWeight = previous?.weight ?? 0;
    const weight = next?.weight ?? 0;
    return !base || weight === previousWeight
      ? []
      : [{ ...base, weight, previousWeight }];
  }).sort(
    (a, b) =>
      Math.abs(b.weight - b.previousWeight) -
      Math.abs(a.weight - a.previousWeight),
  );
}

export function interestWeights(
  interests: string[],
  signals: ProfileSignal[],
  now = new Date(),
): InterestWeight[] {
  const selected = new Set(chosenTopics(interests));
  const learned = new Map<string, number>();
  for (const signal of signals) {
    const age =
      Math.max(0, now.getTime() - signal.createdAt.getTime()) / 86400000;
    for (const id of eventTopics(signal.event)) {
      learned.set(
        id,
        (learned.get(id) ?? 0) +
          SIGNAL_STRENGTH[signal.kind] * Math.pow(0.5, age / 30),
      );
    }
  }
  return INTEREST_TOPICS.map((topic) => {
    const explicit = selected.has(topic.id);
    const activity = Math.max(-2, Math.min(3, learned.get(topic.id) ?? 0));
    return {
      id: topic.id,
      label: topic.label,
      accent: topic.accent,
      weight:
        Math.round(Math.max(0, (explicit ? 5 : 0) + activity) * 100) / 100,
      source: explicit ? (activity !== 0 ? 'both' : 'chosen') : 'activity',
    } satisfies InterestWeight;
  })
    .filter((topic) => topic.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}
export function rankPreferenceEvent(
  event: Pick<
    Event,
    | 'tags'
    | 'impactSdgGoals'
    | 'location'
    | 'registrationType'
    | 'donationsEnabled'
    | 'impactPaths'
  >,
  profile: InterestProfile,
  signals: ProfileSignal[],
) {
  const ids = new Set(eventTopics(event));
  const matches = profile.weights.filter((weight) => ids.has(weight.id));
  let score = matches.reduce((sum, weight) => sum + weight.weight, 0);
  const cityMatch = Boolean(
    profile.city &&
      event.location?.toLowerCase().includes(profile.city.toLowerCase()),
  );
  if (cityMatch) score += 3;
  const mode =
    event.registrationType === 'volunteer'
      ? 'volunteer'
      : event.registrationType === 'donation'
        ? 'donate'
        : 'attend';
  if (
    profile.helpModes.includes(mode) ||
    (event.donationsEnabled && profile.helpModes.includes('donate'))
  )
    score += 1;
  const tags = new Set(event.tags.map((tag) => tag.toLowerCase()));
  const paths = impactIds(event.impactPaths);
  let positiveAffinity = 0;
  let negativeAffinity = 0;
  for (const signal of signals) {
    const otherTags = new Set(
      signal.event.tags.map((tag) => tag.toLowerCase()),
    );
    const overlap = [...tags].filter((tag) => otherTags.has(tag)).length;
    const union = new Set([...tags, ...otherTags]).size;
    const sharedPath = impactIds(signal.event.impactPaths).some((id) =>
      paths.includes(id),
    );
    const sameFormat = signal.event.registrationType === event.registrationType;
    const age = Math.max(0, Date.now() - signal.createdAt.getTime()) / 86400000;
    const affinity =
      AFFINITY_STRENGTH[signal.kind] *
      Math.pow(0.5, age / 30) *
      ((union ? overlap / union : 0) +
        (sharedPath ? 0.5 : 0) +
        (sameFormat ? 0.25 : 0));
    positiveAffinity = Math.max(positiveAffinity, affinity);
    negativeAffinity = Math.min(negativeAffinity, affinity);
  }
  score += Math.max(-2, Math.min(2, positiveAffinity + negativeAffinity));
  const strongest = matches[0];
  const reason = strongest
    ? strongest.source === 'activity'
      ? `Inspired by your interest in ${strongest.label.toLowerCase()}`
      : `Because you chose ${strongest.label.toLowerCase()}`
    : cityMatch
      ? `Near ${profile.city}`
      : profile.helpModes.includes(mode)
        ? `A way to ${mode}`
        : 'Explore something new';
  return { score, reason };
}
