const LAGOS_OFFSET_MINUTES = 60;
const ACTIVE_APPOINTMENT_STATUSES = { not: 'CANCELLED' };

function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? { year, month, day, date }
    : null;
}

function lagosDateTime(dateParts, time) {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute - LAGOS_OFFSET_MINUTES));
}

function lagosLocalParts(value) {
  const local = new Date(value.getTime() + LAGOS_OFFSET_MINUTES * 60_000);
  return {
    date: local.toISOString().slice(0, 10),
    dayOfWeek: local.getUTCDay(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    seconds: local.getUTCSeconds(),
    milliseconds: local.getUTCMilliseconds(),
  };
}

function lagosDateString(value) {
  return lagosLocalParts(value).date;
}

function formatTime(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function slotFitsAvailability(startAt, availability) {
  const local = lagosLocalParts(startAt);
  const [startHour, startMinute] = availability.startTime.split(':').map(Number);
  const [endHour, endMinute] = availability.endTime.split(':').map(Number);
  const startMinuteOfDay = local.hour * 60 + local.minute;
  const availabilityStart = startHour * 60 + startMinute;
  const availabilityEnd = endHour * 60 + endMinute;
  const offset = startMinuteOfDay - availabilityStart;
  return local.seconds === 0
    && local.milliseconds === 0
    && offset >= 0
    && offset % availability.slotMinutes === 0
    && offset + availability.slotMinutes <= availabilityEnd - availabilityStart;
}

async function findAvailabilityForStart(prisma, doctorId, startAt) {
  const local = lagosLocalParts(startAt);
  const dateParts = parseDateOnly(local.date);
  if (!dateParts) return null;
  const availability = await prisma.availability.findUnique({
    where: { doctorId_dayOfWeek: { doctorId, dayOfWeek: local.dayOfWeek } },
    include: { doctor: { select: { user: { select: { isActive: true } } } } },
  });
  return availability && availability.doctor.user.isActive && slotFitsAvailability(startAt, availability) ? availability : null;
}

async function isSlotOpen(prisma, doctorId, startAt, slotMinutes, excludeAppointmentId, excludeWaitlistId) {
  const endAt = new Date(startAt.getTime() + slotMinutes * 60_000);
  const existing = await prisma.appointment.findFirst({
    where: {
      doctorId,
      status: ACTIVE_APPOINTMENT_STATUSES,
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: { id: true },
  });
  if (existing) return false;
  const activeOffers = await prisma.waitlist.findMany({
    where: {
      doctorId,
      status: 'NOTIFIED',
      offerExpiresAt: { gt: new Date() },
      offeredStartAt: { lt: endAt },
      ...(excludeWaitlistId ? { id: { not: excludeWaitlistId } } : {}),
    },
    select: { offeredStartAt: true },
  });
  return !activeOffers.some((offer) => offer.offeredStartAt.getTime() + slotMinutes * 60_000 > startAt.getTime());
}

async function getSlots(prisma, doctorId, dateValue) {
  const dateParts = parseDateOnly(dateValue);
  if (!dateParts) return { error: 'Use a valid appointment date in YYYY-MM-DD format.' };

  const now = new Date();
  const todayParts = parseDateOnly(lagosLocalParts(now).date);
  const daysFromToday = Math.floor((dateParts.date.getTime() - todayParts.date.getTime()) / 86_400_000);
  if (daysFromToday < 0 || daysFromToday > 90) {
    return { error: 'Choose a date from today through the next 90 days.' };
  }

  const availability = await prisma.availability.findUnique({
    where: { doctorId_dayOfWeek: { doctorId, dayOfWeek: dateParts.date.getUTCDay() } },
  });
  if (!availability) return { slots: [] };

  const dayStart = lagosDateTime(dateParts, '00:00');
  const nextDay = new Date(dateParts.date.getTime() + 86_400_000);
  const nextParts = { year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1, day: nextDay.getUTCDate() };
  const dayEnd = lagosDateTime(nextParts, '00:00');
  const occupied = await prisma.appointment.findMany({
    where: {
      doctorId,
      status: ACTIVE_APPOINTMENT_STATUSES,
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
    },
    select: { startAt: true, endAt: true },
  });
  const activeOffers = await prisma.waitlist.findMany({
    where: {
      doctorId,
      status: 'NOTIFIED',
      offerExpiresAt: { gt: now },
      offeredStartAt: { gte: dayStart, lt: dayEnd },
    },
    select: { offeredStartAt: true },
  });

  const [startHour, startMinute] = availability.startTime.split(':').map(Number);
  const [endHour, endMinute] = availability.endTime.split(':').map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const slots = [];
  for (let minute = start; minute + availability.slotMinutes <= end; minute += availability.slotMinutes) {
    const slotTime = formatTime(Math.floor(minute / 60), minute % 60);
    const startAt = lagosDateTime(dateParts, slotTime);
    const endAt = new Date(startAt.getTime() + availability.slotMinutes * 60_000);
    if (startAt <= now) continue;
    const booked = occupied.some((appointment) => appointment.startAt < endAt && appointment.endAt > startAt)
      || activeOffers.some((offer) => offer.offeredStartAt < endAt && new Date(offer.offeredStartAt.getTime() + availability.slotMinutes * 60_000) > startAt);
    if (!booked) slots.push({ startAt: startAt.toISOString(), endAt: endAt.toISOString(), time: slotTime, durationMinutes: availability.slotMinutes });
  }
  return { slots };
}

module.exports = { getSlots, findAvailabilityForStart, isSlotOpen, parseDateOnly, lagosDateString, lagosDateTime };
