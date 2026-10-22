import type { CreateEventDto } from '../event/dto/create-event.dto';

export type EventCreationUpdates = Partial<
  Pick<
    CreateEventDto,
    | 'title'
    | 'description'
    | 'impactTitle'
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
    | 'links'
    | 'tags'
  >
>;

export type EventCreationDraft = EventCreationUpdates & {
  ticketCount: number;
  volunteerRoleCount: number;
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
  | 'Volunteering'
  | 'Cover'
  | 'Links';

export interface EventCreationAssistantReply {
  reply: string;
  choices: string[];
  section: EventCreationSection | 'Review' | null;
  updates: EventCreationUpdates;
}
