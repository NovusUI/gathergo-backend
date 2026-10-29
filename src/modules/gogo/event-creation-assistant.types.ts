import type { CreateEventDto } from '../event/dto/create-event.dto';

export type EventCreationUpdates = Partial<
  Pick<
    CreateEventDto,
    | 'title'
    | 'description'
    | 'impactDescription'
    | 'isPhysicalEvent'
    | 'location'
    | 'startDate'
    | 'endDate'
    | 'registrationType'
    | 'registrationFee'
    | 'registrationAttendees'
    | 'donationTarget'
    | 'donationsEnabled'
    | 'foodBankTotalMeals'
    | 'foodBankSlotCapacity'
    | 'foodBankSlotMinutes'
    | 'links'
    | 'tags'
  >
>;

export type EventCreationDraft = EventCreationUpdates & {
  registrationType: CreateEventDto['registrationType'];
  ticketCount: number;
  volunteerRoleCount: number;
  impactMapCount: number;
  hasImpactGoalOrPath: boolean;
  hasCoverImage: boolean;
};

export type EventCreationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type EventCreationSection =
  | 'Date and Time'
  | 'Location'
  | 'Pricing'
  | 'Story'
  | EventCreationOptionalSection;

export const EVENT_CREATION_OPTIONAL_SECTIONS = [
  'Impact story',
  'Impact map',
  'Volunteering',
  'Links',
  'Interests',
  'Cover',
] as const;

export type EventCreationOptionalSection =
  (typeof EVENT_CREATION_OPTIONAL_SECTIONS)[number];

export interface EventCreationAssistantReply {
  reply: string;
  choices: string[];
  section: EventCreationSection | 'Review' | null;
  completedSection: EventCreationOptionalSection | null;
  suggestedImpactStory: string | null;
  updates: EventCreationUpdates;
}
