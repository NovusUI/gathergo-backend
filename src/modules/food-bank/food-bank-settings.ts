import { BadRequestException } from '@nestjs/common';
export function assertFoodBankSettings(event: {
  registrationType: string;
  isPhysicalEvent: boolean;
  reoccurring: string;
  startDate: Date;
  endDate: Date;
  foodBankTotalMeals?: number | null;
  foodBankSlotCapacity?: number | null;
  foodBankSlotMinutes?: number | null;
}) {
  if (event.registrationType !== 'foodbank') {
    if (
      [
        event.foodBankTotalMeals,
        event.foodBankSlotCapacity,
        event.foodBankSlotMinutes,
      ].some((value) => value != null)
    )
      throw new BadRequestException(
        'Collection settings are only available for food banks',
      );
    return;
  }
  const {
    foodBankTotalMeals: total,
    foodBankSlotCapacity: capacity,
    foodBankSlotMinutes: minutes,
  } = event;
  if (!event.isPhysicalEvent || event.reoccurring !== 'NONE')
    throw new BadRequestException(
      'Food banks require a physical venue and one collection date range',
    );
  if (
    total == null ||
    capacity == null ||
    minutes == null ||
    !Number.isInteger(total) ||
    total < 1 ||
    total > 1000000 ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 10000 ||
    capacity > total ||
    !Number.isInteger(minutes) ||
    minutes < 5 ||
    minutes > 120
  )
    throw new BadRequestException(
      'Set valid meal capacity and collection windows',
    );
  const windows = Math.ceil(
    (event.endDate.getTime() - event.startDate.getTime()) / (minutes * 60000),
  );
  if (windows < 1 || windows * capacity < total)
    throw new BadRequestException(
      'Extend collection hours or increase the window capacity to accommodate all meals',
    );
}
