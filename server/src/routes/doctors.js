const { Router } = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/authenticate');
const { getSlots } = require('../services/scheduling');

const router = Router();
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const availabilitySchema = z.object({
  availability: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(timePattern),
    endTime: z.string().regex(timePattern),
    slotMinutes: z.number().int().min(15).max(120),
  })).max(7),
});

router.get('/departments', async (_req, res, next) => {
  try {
    const departments = await prisma.department.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return res.json({ success: true, departments });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const departmentId = typeof req.query.departmentId === 'string' ? req.query.departmentId : undefined;
  try {
    const doctors = await prisma.doctorProfile.findMany({
      where: {
        user: {
          isActive: true,
          ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        },
        ...(departmentId ? { departmentId } : {}),
      },
      take: 50,
      orderBy: { user: { name: 'asc' } },
      select: {
        id: true,
        specialization: true,
        bio: true,
        department: { select: { id: true, name: true } },
        user: { select: { name: true } },
      },
    });
    return res.json({ success: true, doctors });
  } catch (error) {
    return next(error);
  }
});

router.get('/me/availability', authenticate, requireRole('DOCTOR'), async (req, res, next) => {
  try {
    const profile = await prisma.doctorProfile.findUnique({
      where: { userId: req.auth.userId },
      select: { id: true, availability: { orderBy: { dayOfWeek: 'asc' } } },
    });
    if (!profile) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    return res.json({ success: true, availability: profile.availability });
  } catch (error) {
    return next(error);
  }
});

router.put('/me/availability', authenticate, requireRole('DOCTOR'), async (req, res, next) => {
  const parsed = availabilitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Provide up to seven valid weekly availability entries.', errors: parsed.error.issues });
  }
  const entries = parsed.data.availability;
  if (new Set(entries.map((entry) => entry.dayOfWeek)).size !== entries.length) {
    return res.status(400).json({ success: false, message: 'Each weekday can appear only once.' });
  }
  for (const entry of entries) {
    const [startHour, startMinute] = entry.startTime.split(':').map(Number);
    const [endHour, endMinute] = entry.endTime.split(':').map(Number);
    if (endHour * 60 + endMinute <= startHour * 60 + startMinute) {
      return res.status(400).json({ success: false, message: 'Availability end time must be after start time.' });
    }
  }

  try {
    const profile = await prisma.doctorProfile.findUnique({ where: { userId: req.auth.userId }, select: { id: true } });
    if (!profile) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    const availability = await prisma.$transaction(async (tx) => {
      await tx.availability.deleteMany({ where: { doctorId: profile.id } });
      if (entries.length) {
        await tx.availability.createMany({
          data: entries.map((entry) => ({ ...entry, doctorId: profile.id })),
        });
      }
      return tx.availability.findMany({ where: { doctorId: profile.id }, orderBy: { dayOfWeek: 'asc' } });
    });
    return res.json({ success: true, availability });
  } catch (error) {
    return next(error);
  }
});

router.get('/:doctorId/slots', async (req, res, next) => {
  if (typeof req.query.date !== 'string') {
    return res.status(400).json({ success: false, message: 'Provide a date in YYYY-MM-DD format.' });
  }
  try {
    const doctor = await prisma.doctorProfile.findFirst({ where: { id: req.params.doctorId, user: { isActive: true } }, select: { id: true } });
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found.' });
    const result = await getSlots(prisma, doctor.id, req.query.date);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    return res.json({ success: true, doctorId: doctor.id, date: req.query.date, slots: result.slots });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
