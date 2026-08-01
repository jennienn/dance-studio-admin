export function advanceNoticeUnavailableSlots(selectedDate: string, today: string, currentMinute: number) {
  if (selectedDate !== today) return [];
  const minimumStart = currentMinute + 120;
  const unavailable: number[] = [];
  for (let slot = 600; slot <= 1260; slot += 30) {
    if (slot < minimumStart) unavailable.push(slot);
  }
  return unavailable;
}
