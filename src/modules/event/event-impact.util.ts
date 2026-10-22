import { Event, Prisma, RegistrationType } from '@prisma/client';

export const impactEventWhere = {
  OR: [
    { impactTitle: { not: null } },
    { impactDescription: { not: null } },
    { registrationType: RegistrationType.donation },
    { registrationType: RegistrationType.volunteer },
  ],
} satisfies Prisma.EventWhereInput;

export function hasEventImpact(
  event: Pick<Event, 'registrationType' | 'impactTitle' | 'impactDescription'>,
) {
  return (
    event.registrationType === RegistrationType.donation ||
    event.registrationType === RegistrationType.volunteer ||
    Boolean(event.impactTitle || event.impactDescription)
  );
}
