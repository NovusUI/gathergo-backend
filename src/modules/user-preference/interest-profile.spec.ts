import {
  eventTopics,
  interestWeights,
  interestWeightChanges,
  rankPreferenceEvent,
} from './interest-profile';
import type { InterestProfile, ProfileSignal } from './interest-profile';

const now = new Date('2026-10-23T12:00:00Z');
const nature = {
  tags: ['Nature', 'Outdoor'],
  impactSdgGoals: null,
  impactPaths: [{ id: 'direct_action' }],
  registrationType: 'volunteer' as const,
};
const profile: InterestProfile = {
  interests: ['Nature'],
  helpModes: ['attend'],
  city: 'Lagos',
  learningEnabled: true,
  weights: interestWeights(['Nature'], []),
};

describe('Personal interest ranking', () => {
  it('distinguishes survey reactions and protects explicitly chosen topics', () => {
    const weights = (kind: ProfileSignal['kind']) =>
      interestWeights(
        ['Nature'],
        [{ event: nature, kind, createdAt: now }],
        now,
      );
    expect(weights('LOVED')[0].weight).toBe(7);
    expect(weights('OKAY')[0].weight).toBe(5.5);
    expect(weights('NOT_FOR_ME')[0].weight).toBe(3.5);
    const negative: ProfileSignal = {
      event: nature,
      kind: 'NOT_FOR_ME',
      createdAt: now,
    };
    expect(
      interestWeights(
        ['Nature'],
        Array.from({ length: 10 }, () => negative),
        now,
      )[0].weight,
    ).toBe(3);
    expect(interestWeights([], [negative], now)).toEqual([]);
  });
  it('shows actual before-and-after weights, including removed topics', () => {
    const before = interestWeights(
      [],
      [{ event: nature, kind: 'LOVED', createdAt: now }],
      now,
    );
    expect(interestWeightChanges(before, [])).toEqual(
      before.map((topic) => ({
        ...topic,
        previousWeight: topic.weight,
        weight: 0,
      })),
    );
    expect(interestWeightChanges(before, before)).toEqual([]);
  });
  it('reduces similar-event affinity for Not for me', () => {
    const event = { ...nature, location: null, donationsEnabled: false };
    const negative: ProfileSignal = {
      event: nature,
      kind: 'NOT_FOR_ME',
      createdAt: new Date(),
    };
    expect(rankPreferenceEvent(event, profile, [negative]).score).toBeLessThan(
      rankPreferenceEvent(event, profile, []).score,
    );
  });

  it('understands both event interests and selected impact goals', () => {
    expect(eventTopics(nature)).toEqual(['Nature', 'Community']);
    expect(
      eventTopics({
        tags: [],
        impactPaths: null,
        impactSdgGoals: [{ id: 'sdg_4' }, { id: 'sdg_15' }],
      }),
    ).toEqual(['Nature', 'Education']);
  });
  it('understands impact paths when an organiser has not added tags or global goals', () => {
    expect(
      eventTopics({
        tags: [],
        impactSdgGoals: null,
        impactPaths: [{ id: 'health_action' }],
      }),
    ).toEqual(['Health']);
  });
  it('keeps a chosen interest stronger than many casual views', () => {
    const signal: ProfileSignal = {
      event: { ...nature, tags: ['Education'] },
      kind: 'VIEW',
      createdAt: now,
    };
    const weights = interestWeights(
      ['Nature'],
      Array.from({ length: 100 }, () => signal),
      now,
    );
    expect(weights[0]).toMatchObject({
      id: 'Nature',
      source: 'chosen',
      weight: 5,
    });
    expect(weights[1]).toMatchObject({
      id: 'Education',
      source: 'activity',
      weight: 3,
    });
  });
  it('fades activity over time while retaining explicit choices', () => {
    const fresh: ProfileSignal = {
      event: nature,
      kind: 'LIKE',
      createdAt: now,
    };
    const old = {
      ...fresh,
      createdAt: new Date(now.getTime() - 30 * 86400000),
    };
    expect(interestWeights([], [fresh], now)[0].weight).toBe(1.5);
    expect(interestWeights([], [old], now)[0].weight).toBe(0.75);
    expect(interestWeights(['Nature'], [old], now)[0]).toMatchObject({
      source: 'both',
      weight: 5.75,
    });
  });
  it('uses the same signal strength for donations and other participation', () => {
    for (const kind of ['ATTEND', 'DONATE', 'VOLUNTEER'] as const)
      expect(
        interestWeights([], [{ event: nature, kind, createdAt: now }], now)[0]
          .weight,
      ).toBe(2);
  });
  it('explains chosen causes and includes free registration as attendance', () => {
    const event = {
      ...nature,
      location: 'Ikeja, LAGOS',
      registrationType: 'registration' as const,
      donationsEnabled: false,
    };
    expect(rankPreferenceEvent(event, profile, [])).toEqual({
      score: 9,
      reason: 'Because you chose environment',
    });
  });
  it('uses event examples to distinguish formats and activities within a cause', () => {
    const base = { ...nature, location: null, donationsEnabled: false };
    const liked: ProfileSignal = {
      event: nature,
      kind: 'LIKE',
      createdAt: new Date(),
    };
    const similar = rankPreferenceEvent(base, { ...profile, city: null }, [
      liked,
    ]);
    const different = rankPreferenceEvent(
      {
        ...base,
        registrationType: 'ticket',
        tags: ['Nature'],
        impactPaths: [{ id: 'awareness_education' }],
      },
      { ...profile, city: null },
      [liked],
    );
    expect(similar.score).toBeGreaterThan(different.score);
  });
  it('has a truthful discovery reason for an empty or deleted map', () => {
    const event = { ...nature, location: null, donationsEnabled: false };
    expect(
      rankPreferenceEvent(
        event,
        {
          interests: [],
          helpModes: [],
          city: null,
          weights: [],
          learningEnabled: false,
        },
        [],
      ),
    ).toEqual({ score: 0, reason: 'Explore something new' });
  });
});
