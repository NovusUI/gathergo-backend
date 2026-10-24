import { EVENT_CREATION_OPTIONAL_SECTIONS } from './event-creation-assistant.types';
import type {
  EventCreationAssistantReply,
  EventCreationDraft,
  EventCreationOptionalSection,
  EventCreationSection,
} from './event-creation-assistant.types';

const QUESTIONS: Record<EventCreationSection | 'Review', string> = {
  Story: 'What will people come together to do?',
  'Date and Time': 'When will the event start and finish?',
  Location: 'Where will people meet?',
  Pricing: 'How will people take part?',
  Volunteering: 'Could a few extra hands help?',
  Cover: 'Would you like to add a cover image?',
  'Impact story': 'What could this event contribute to your community?',
  'Impact map': 'Let’s find a few ideas that fit your story.',
  Links: 'Any links people should have?',
  Interests: 'Which interests will help people find your event?',
  Review: 'Ready to review your event?',
};

export function getRequiredEventSection(
  draft: EventCreationDraft,
): EventCreationSection | null {
  if (!draft.title || !draft.description) return 'Story';
  if (!draft.startDate || !draft.endDate) return 'Date and Time';
  if (
    draft.isPhysicalEvent === undefined ||
    (draft.isPhysicalEvent && !draft.location)
  )
    return 'Location';
  if (
    draft.registrationType === 'registration' &&
    (draft.registrationFee === undefined ||
      draft.registrationAttendees === undefined)
  )
    return 'Pricing';
  if (draft.registrationType === 'ticket' && draft.ticketCount === 0)
    return 'Pricing';
  if (
    draft.registrationType === 'donation' &&
    draft.donationTarget === undefined
  )
    return 'Pricing';
  if (draft.registrationType === 'volunteer') {
    if (!draft.impactDescription) return 'Impact story';
    if (draft.volunteerRoleCount === 0) return 'Volunteering';
  }
  return null;
}

export function getOptionalEventSection(
  draft: EventCreationDraft,
  addressedSections: EventCreationOptionalSection[],
): EventCreationOptionalSection | 'Review' {
  let next: EventCreationOptionalSection | 'Review' = 'Review';
  if (!addressedSections.includes('Impact story')) next = 'Impact story';
  else if (
    !addressedSections.includes('Impact map') &&
    draft.impactDescription &&
    draft.impactMapCount === 0
  )
    next = 'Impact map';
  else if (!addressedSections.includes('Links') && !draft.links?.length)
    next = 'Links';
  else if (
    !addressedSections.includes('Interests') &&
    !draft.tags?.length &&
    !(draft.impactDescription && draft.hasImpactGoalOrPath)
  )
    next = 'Interests';
  return next;
}

export function guideEventCreationReply(
  result: EventCreationAssistantReply,
  draft: EventCreationDraft,
  addressedSections: EventCreationOptionalSection[],
): EventCreationAssistantReply {
  const required = getRequiredEventSection(draft);
  if (required) {
    const optional = EVENT_CREATION_OPTIONAL_SECTIONS.some(
      (section) => section === result.section,
    );
    if (
      !(
        draft.registrationType === 'volunteer' && result.section === 'Pricing'
      ) &&
      result.section !== 'Review' &&
      (!optional || result.section === required)
    )
      return result;
    return {
      ...result,
      reply:
        required === 'Impact story' && draft.registrationType === 'volunteer'
          ? 'What will this volunteer event contribute?'
          : required === 'Volunteering' &&
              draft.registrationType === 'volunteer'
            ? 'What role can volunteers help with?'
            : QUESTIONS[required],
      choices: [],
      section: required,
    };
  }

  const next = getOptionalEventSection(draft, addressedSections);
  if (result.section === next) return result;
  return { ...result, reply: QUESTIONS[next], choices: [], section: next };
}
