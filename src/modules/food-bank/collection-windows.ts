export interface CollectionSettings {
  startDate: Date;
  endDate: Date;
  foodBankTotalMeals: number;
  foodBankSlotCapacity: number;
  foodBankSlotMinutes: number;
}

export function nextCollectionWindow(
  event: CollectionSettings,
  reservations: { collectionStart: Date; count: number }[],
  now: Date,
): { start: Date; end: Date } | null {
  const reserved = reservations.reduce((sum, slot) => sum + slot.count, 0);
  if (reserved >= event.foodBankTotalMeals) return null;
  const duration = event.foodBankSlotMinutes * 60_000;
  const first = Math.max(
    0,
    Math.floor((now.getTime() - event.startDate.getTime()) / duration),
  );
  const counts = new Map(
    reservations.map((slot) => [slot.collectionStart.getTime(), slot.count]),
  );
  for (
    let start = event.startDate.getTime() + first * duration;
    start < event.endDate.getTime();
    start += duration
  ) {
    if ((counts.get(start) ?? 0) < event.foodBankSlotCapacity) {
      return {
        start: new Date(start),
        end: new Date(Math.min(start + duration, event.endDate.getTime())),
      };
    }
  }
  return null;
}
