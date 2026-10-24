import {
  getOptionalEventSection,
  getRequiredEventSection,
  guideEventCreationReply,
} from './event-creation-assistant.flow';
import type {
  EventCreationAssistantReply,
  EventCreationDraft,
  EventCreationOptionalSection,
} from './event-creation-assistant.types';

const complete: EventCreationDraft = {
  title: 'Park day',
  description: 'A morning with neighbours.',
  startDate: '2035-02-03T09:00:00Z',
  endDate: '2035-02-03T11:00:00Z',
  isPhysicalEvent: true,
  location: 'Lagos park',
  registrationType: 'registration',
  registrationFee: 0,
  registrationAttendees: 25,
  ticketCount: 0,
  volunteerRoleCount: 0,
  impactMapCount: 0,
  hasImpactGoalOrPath: false,
};
const reply: EventCreationAssistantReply = {
  reply: 'Ready to review?',
  choices: [],
  section: 'Review',
  completedSection: null,
  suggestedImpactStory: null,
  updates: {},
};

describe('Gogo guided event steps', () => {
  it('collects compulsory details before inviting optional ones', () => {
    expect(
      getRequiredEventSection({ ...complete, description: undefined }),
    ).toBe('Story');
    expect(getRequiredEventSection({ ...complete, endDate: undefined })).toBe(
      'Date and Time',
    );
    expect(getRequiredEventSection({ ...complete, location: undefined })).toBe(
      'Location',
    );
    expect(
      getRequiredEventSection({ ...complete, registrationFee: undefined }),
    ).toBe('Pricing');
    expect(
      guideEventCreationReply(reply, { ...complete, startDate: undefined }, [])
        .section,
    ).toBe('Date and Time');
  });
  it('invites impact story, map, links and interests in order for registration events', () => {
    const draft = {
      ...complete,
      impactDescription: 'Restore the neighbourhood park.',
    };
    const addressed: EventCreationOptionalSection[] = [];
    const order: EventCreationOptionalSection[] = [
      'Impact story',
      'Impact map',
      'Links',
      'Interests',
    ];
    for (const section of order) {
      expect(guideEventCreationReply(reply, draft, addressed).section).toBe(
        section,
      );
      addressed.push(section);
    }
    expect(guideEventCreationReply(reply, draft, addressed).section).toBe(
      'Review',
    );
  });
  it('does not invite an impact map or volunteers after skipping a blank impact story', () => {
    expect(getOptionalEventSection(complete, ['Impact story'])).toBe('Links');
  });
  it.each(['ticket', 'registration', 'donation'] as const)(
    'does not suggest volunteers for a %s event with impact',
    (registrationType) => {
      const draft = {
        ...complete,
        registrationType,
        ticketCount: 1,
        donationTarget: 500000,
        impactDescription: 'Restore the neighbourhood park.',
        impactMapCount: 1,
      };
      expect(
        guideEventCreationReply({ ...reply, section: 'Volunteering' }, draft, [
          'Impact story',
          'Impact map',
        ]),
      ).toMatchObject({
        section: 'Links',
        reply: 'Any links people should have?',
      });
    },
  );
  it('skips interests after a story and a selected global goal or impact path', () => {
    const draft = {
      ...complete,
      impactDescription: 'Restore the neighbourhood park.',
      impactMapCount: 1,
      hasImpactGoalOrPath: true,
    };
    const addressed: EventCreationOptionalSection[] = [
      'Impact story',
      'Impact map',
      'Volunteering',
    ];
    expect(getOptionalEventSection(draft, addressed)).toBe('Links');
    addressed.push('Links');
    expect(getOptionalEventSection(draft, addressed)).toBe('Review');
    expect(
      guideEventCreationReply(
        { ...reply, section: 'Interests', choices: ['Nature'] },
        draft,
        addressed,
      ),
    ).toMatchObject({
      section: 'Review',
      reply: 'Ready to review your event?',
      choices: [],
    });
  });
  it.each([
    {
      impactDescription: 'Care for the park.',
      impactMapCount: 0,
      hasImpactGoalOrPath: false,
    },
    {
      impactDescription: 'Care for the park.',
      impactMapCount: 1,
      hasImpactGoalOrPath: false,
    },
    { impactDescription: '', impactMapCount: 1, hasImpactGoalOrPath: true },
  ])(
    'still offers interests without both a story and a goal or path (%#)',
    (impact) => {
      expect(
        getOptionalEventSection({ ...complete, ...impact }, [
          'Impact story',
          'Impact map',
          'Volunteering',
          'Links',
        ]),
      ).toBe('Interests');
    },
  );
  it('keeps impact maps available online but does not offer physical volunteering', () => {
    const online = {
      ...complete,
      isPhysicalEvent: false,
      impactDescription: 'Support local learners.',
    };
    expect(getOptionalEventSection(online, ['Impact story'])).toBe(
      'Impact map',
    );
    expect(
      getOptionalEventSection(online, ['Impact story', 'Impact map']),
    ).toBe('Links');
  });
  it('does not repeat existing map selections, volunteer roles, links or interests', () => {
    expect(
      getOptionalEventSection(
        {
          ...complete,
          impactDescription: 'Care for the park.',
          impactMapCount: 1,
          registrationType: 'volunteer',
          volunteerRoleCount: 2,
          links: ['https://example.com'],
          tags: ['Nature'],
        },
        ['Impact story'],
      ),
    ).toBe('Review');
  });
  it('does not reopen participation setup for a volunteer-only event', () => {
    const volunteer = { ...complete, registrationType: 'volunteer' as const };
    expect(
      guideEventCreationReply({ ...reply, section: 'Pricing' }, volunteer, [])
        .section,
    ).toBe('Impact story');
  });
  it('cannot skip required stories or roles for volunteer-only events', () => {
    const volunteer = { ...complete, registrationType: 'volunteer' as const };
    const addressed: EventCreationOptionalSection[] = [
      'Impact story',
      'Volunteering',
    ];
    expect(guideEventCreationReply(reply, volunteer, addressed).section).toBe(
      'Impact story',
    );
    expect(
      guideEventCreationReply(
        reply,
        { ...volunteer, impactDescription: 'Restore the park.' },
        addressed,
      ).section,
    ).toBe('Volunteering');
  });
});
