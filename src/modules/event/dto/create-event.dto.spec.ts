import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateEventDto } from './create-event.dto';

describe('CreateEventDto', () => {
  it('does not require location when multipart sends isPhysicalEvent as "false"', () => {
    const dto = plainToInstance(CreateEventDto, {
      title: 'Online Donation Event',
      description: 'Support from anywhere',
      registrationType: 'donation',
      donationTarget: '500000',
      isPhysicalEvent: 'false',
      location: '',
      startDate: '2026-04-02T10:00:00.000Z',
      endDate: '2026-04-03T10:00:00.000Z',
    });

    const errors = validateSync(dto);
    const locationError = errors.find((error) => error.property === 'location');

    expect(dto.isPhysicalEvent).toBe(false);
    expect(locationError).toBeUndefined();
  });

  it('normalizes event links without requiring an explicit https prefix', () => {
    const dto = plainToInstance(CreateEventDto, {
      title: 'Community Meetup',
      description: 'Let us connect online',
      registrationType: 'registration',
      registrationAttendees: 50,
      registrationFee: 0,
      isPhysicalEvent: 'false',
      links: [' instagram.com/gathergo ', 'wa.me/1234567890'],
      startDate: '2026-04-02T10:00:00.000Z',
      endDate: '2026-04-03T10:00:00.000Z',
    });

    const errors = validateSync(dto);
    const linkError = errors.find((error) => error.property === 'links');

    expect(dto.links).toEqual([
      'https://instagram.com/gathergo',
      'https://wa.me/1234567890',
    ]);
    expect(linkError).toBeUndefined();
  });
});
