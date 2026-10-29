const { getSlots, lagosDateTime, parseDateOnly } = require('./scheduling');

describe('appointment scheduling helpers', () => {
  test('accepts real calendar dates and rejects invalid or malformed dates', () => {
    expect(parseDateOnly('2028-02-29')).not.toBeNull();
    expect(parseDateOnly('2027-02-29')).toBeNull();
    expect(parseDateOnly('2027-2-09')).toBeNull();
    expect(parseDateOnly('not-a-date')).toBeNull();
  });

  test('converts Nigeria local time to the correct UTC instant', () => {
    const date = parseDateOnly('2026-11-02');
    expect(lagosDateTime(date, '09:00').toISOString()).toBe('2026-11-02T08:00:00.000Z');
    expect(lagosDateTime(date, '24:00')).toBeNull();
    expect(lagosDateTime(date, '09:60')).toBeNull();
  });

  test('returns an error for malformed appointment dates', async () => {
    await expect(getSlots({}, 'doctor-1', '2026-2-01')).resolves.toEqual({
      error: 'Use a valid appointment date in YYYY-MM-DD format.',
    });
  });

  test('builds 30-minute slots in Nigeria time and excludes occupied slots', async () => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 7);
    const dateValue = date.toISOString().slice(0, 10);
    const parts = parseDateOnly(dateValue);
    const occupiedStart = lagosDateTime(parts, '09:30');
    const prisma = {
      availability: {
        findUnique: jest.fn().mockResolvedValue({ startTime: '09:00', endTime: '16:00', slotMinutes: 30 }),
      },
      appointment: {
        findMany: jest.fn().mockResolvedValue([{ startAt: occupiedStart, endAt: new Date(occupiedStart.getTime() + 30 * 60_000) }]),
      },
      waitlist: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const result = await getSlots(prisma, 'doctor-1', dateValue);

    expect(result.slots).toHaveLength(13);
    expect(result.slots[0].time).toBe('09:00');
    expect(result.slots.some((slot) => slot.time === '09:30')).toBe(false);
    expect(result.slots.every((slot) => slot.durationMinutes === 30)).toBe(true);
  });
});
