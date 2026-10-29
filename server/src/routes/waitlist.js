const { Router } = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/authenticate');
const { getSlots, parseDateOnly, lagosDateString } = require('../services/scheduling');
const { claimWaitlistOffer, offerNextWaitlist } = require('../services/waitlist');
const safeAppointment = require('../lib/safe-appointment');

const router = Router();
const joinSchema = z.object({ doctorId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

function safeWaitlist(entry) {
  return {
    id: entry.id,
    doctorId: entry.doctorId,
    doctorName: entry.doctor.user.name,
    specialization: entry.doctor.specialization,
    department: entry.doctor.department.name,
    date: entry.date.toISOString().slice(0, 10),
    status: entry.status,
    offeredStartAt: entry.offeredStartAt,
    offerExpiresAt: entry.offerExpiresAt,
    createdAt: entry.createdAt,
  };
}

router.use(authenticate, requireRole('PATIENT'));

router.get('/', async (req, res, next) => {
  try {
    const entries = await prisma.waitlist.findMany({
      where: { patientId: req.auth.userId },
      include: {
        doctor: {
          include: {
            user: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.json({ success: true, waitlist: entries.map(safeWaitlist) });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Choose a doctor and a date in YYYY-MM-DD format.' });
  const dateParts = parseDateOnly(parsed.data.date);
  if (!dateParts) return res.status(400).json({ success: false, message: 'Choose a valid date.' });
  const daysFromToday = Math.floor((dateParts.date.getTime() - parseDateOnly(lagosDateString(new Date())).date.getTime()) / 86_400_000);
  if (daysFromToday < 0 || daysFromToday > 90) return res.status(400).json({ success: false, message: 'Choose a date from today through the next 90 days.' });

  try {
    const doctor = await prisma.doctorProfile.findFirst({ where: { id: parsed.data.doctorId, user: { isActive: true } }, select: { id: true } });
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found.' });
    const availability = await prisma.availability.findUnique({
      where: { doctorId_dayOfWeek: { doctorId: doctor.id, dayOfWeek: dateParts.date.getUTCDay() } },
      select: { id: true },
    });
    if (!availability) return res.status(400).json({ success: false, message: 'This doctor does not have availability on that weekday. Choose one of their working days.' });
    const slots = await getSlots(prisma, doctor.id, parsed.data.date);
    if (slots.error) return res.status(400).json({ success: false, message: slots.error });
    if (slots.slots.length) {
      return res.status(409).json({ success: false, message: 'Open appointment times remain for this doctor and date.', slots: slots.slots });
    }

    const activeEntry = await prisma.waitlist.findFirst({
      where: { patientId: req.auth.userId, doctorId: doctor.id, date: dateParts.date, status: { in: ['WAITING', 'NOTIFIED'] } },
      select: { id: true },
    });
    if (activeEntry) return res.status(409).json({ success: false, message: 'You already have an active waitlist entry for this doctor and date.' });

    const entry = await prisma.waitlist.create({
      data: { patientId: req.auth.userId, doctorId: doctor.id, date: dateParts.date },
      include: {
        doctor: { include: { user: { select: { name: true } }, department: { select: { name: true } } } },
      },
    });
    return res.status(201).json({ success: true, waitlist: safeWaitlist(entry) });
  } catch (error) {
    if (error.code === 'P2002' || error.code === 'P2034') {
      return res.status(409).json({ success: false, message: 'You already have an active waitlist entry for this doctor and date.' });
    }
    return next(error);
  }
});

router.patch('/:waitlistId/withdraw', async (req, res, next) => {
  try {
    const entry = await prisma.waitlist.findUnique({ where: { id: req.params.waitlistId } });
    if (!entry || entry.patientId !== req.auth.userId) return res.status(404).json({ success: false, message: 'Waitlist entry not found.' });
    if (!['WAITING', 'NOTIFIED'].includes(entry.status)) return res.status(409).json({ success: false, message: 'This waitlist entry is no longer active.' });
    const changed = await prisma.waitlist.updateMany({
      where: { id: entry.id, patientId: req.auth.userId, status: entry.status },
      data: { status: 'CANCELLED', claimToken: null },
    });
    if (!changed.count) return res.status(409).json({ success: false, message: 'This waitlist entry changed. Refresh and try again.' });
    if (entry.status === 'NOTIFIED' && entry.offeredStartAt) {
      await offerNextWaitlist(prisma, entry.doctorId, entry.offeredStartAt);
    }
    return res.json({ success: true, message: 'You have left the waitlist.' });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:waitlistId/claim', async (req, res, next) => {
  try {
    const result = await claimWaitlistOffer(prisma, { waitlistId: req.params.waitlistId, patientId: req.auth.userId });
    if (result.error) return res.status(result.status || 409).json({ success: false, message: result.error });
    return res.json({ success: true, message: result.alreadyClaimed ? 'This offer has already been claimed.' : 'Waitlist appointment claimed.', appointment: result.appointment ? safeAppointment(result.appointment) : undefined, emailSent: result.emailSent });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
