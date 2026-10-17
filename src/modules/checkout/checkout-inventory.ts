import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, ReservationStatus } from '@prisma/client';

export async function lockCheckoutEvent(
  tx: Prisma.TransactionClient,
  eventId: string,
) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException('Event not found');
}

export async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS "now"`;
  return row.now;
}

export async function reservedTicketQuantity(
  tx: Prisma.TransactionClient,
  eventTicketId: string,
  now: Date,
  excludeTransactionId?: string,
) {
  const result = await tx.checkoutReservationItem.aggregate({
    _sum: { quantity: true },
    where: {
      eventTicketId,
      ...(excludeTransactionId
        ? { reservationId: { not: excludeTransactionId } }
        : {}),
      reservation: { status: ReservationStatus.HELD, expiresAt: { gt: now } },
    },
  });
  return result._sum.quantity ?? 0;
}

export async function assertTicketCapacityEdit(
  tx: Prisma.TransactionClient,
  eventTicketId: string,
  remaining: number,
) {
  const reserved = await reservedTicketQuantity(
    tx,
    eventTicketId,
    await databaseNow(tx),
  );
  if (remaining < reserved)
    throw new ConflictException(
      `${reserved} tickets are currently reserved. Capacity cannot be reduced below those reservations.`,
    );
}

export async function registrationOccupancy(
  tx: Prisma.TransactionClient,
  eventId: string,
  now: Date,
  excludeTransactionId?: string,
) {
  const [registered, sponsored, held] = await Promise.all([
    tx.registration.count({ where: { eventId, status: 'active' } }),
    tx.checkoutReservation.count({
      where: {
        status: ReservationStatus.CONFIRMED,
        transaction: {
          eventId,
          paymentType: 'REGISTRATION',
          metadata: {
            path: ['sponsorship', 'beneficiaryType'],
            equals: 'SPONSORED',
          },
        },
      },
    }),
    tx.checkoutReservation.count({
      where: {
        ...(excludeTransactionId
          ? { transactionId: { not: excludeTransactionId } }
          : {}),
        status: ReservationStatus.HELD,
        expiresAt: { gt: now },
        transaction: { eventId, paymentType: 'REGISTRATION' },
      },
    }),
  ]);
  return registered + sponsored + held;
}

export async function assertRegistrationCapacityEdit(
  tx: Prisma.TransactionClient,
  eventId: string,
  capacity: number,
) {
  const occupied = await registrationOccupancy(
    tx,
    eventId,
    await databaseNow(tx),
  );
  if (capacity < occupied)
    throw new ConflictException(
      `${occupied} registration spaces are booked or reserved. Capacity cannot be reduced below them.`,
    );
}
