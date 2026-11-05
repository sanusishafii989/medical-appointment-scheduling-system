const { Router } = require('express');
const express = require('express');
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
const doctorProfileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  specialization: z.string().trim().min(2).max(120),
  bio: z.string().trim().max(500).optional().or(z.literal('')),
});
const allowedProfileImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const profileImageBodyParser = express.raw({ type: [...allowedProfileImageTypes], limit: '2mb' });
function parseProfileImage(req, res, next) {
  profileImageBodyParser(req, res, (error) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Profile photo must be no larger than 2 MB after resizing.' });
    if (error) return next(error);
    return next();
  });
}

function lagosDateKey(date = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function hasValidImageSignature(buffer, contentType) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (contentType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

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
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const departmentId = typeof req.query.departmentId === 'string' ? req.query.departmentId : undefined;
  try {
    const doctors = await prisma.doctorProfile.findMany({
      where: {
        user: { isActive: true },
        ...(search ? { OR: [
          { user: { name: { contains: search, mode: 'insensitive' } } },
          { specialization: { contains: search, mode: 'insensitive' } },
          { department: { name: { contains: search, mode: 'insensitive' } } },
        ] } : {}),
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

router.get('/me/profile', authenticate, requireRole('DOCTOR'), async (req, res, next) => {
  try {
    const profile = await prisma.doctorProfile.findUnique({
      where: { userId: req.auth.userId },
      select: {
        id: true,
        specialization: true,
        bio: true,
        profileImageContentType: true,
        department: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
      },
    });
    if (!profile) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    const { profileImageContentType, ...safeProfile } = profile;
    return res.json({ success: true, profile: { ...safeProfile, hasProfileImage: Boolean(profileImageContentType) } });
  } catch (error) {
    return next(error);
  }
});

router.put('/me/profile', authenticate, requireRole('DOCTOR'), async (req, res, next) => {
  const parsed = doctorProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Review the profile fields and try again.', errors: parsed.error.issues });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const profile = await tx.doctorProfile.findUnique({ where: { userId: req.auth.userId }, select: { id: true } });
      if (!profile) return null;
      const [user, doctorProfile] = await Promise.all([
        tx.user.update({
          where: { id: req.auth.userId },
          data: { name: parsed.data.name, phone: parsed.data.phone || null },
          select: { id: true, name: true, email: true, phone: true, role: true },
        }),
        tx.doctorProfile.update({
          where: { userId: req.auth.userId },
          data: { specialization: parsed.data.specialization, bio: parsed.data.bio || null },
          select: { id: true, specialization: true, bio: true, profileImageBytes: true, department: { select: { id: true, name: true } } },
        }),
      ]);
      return { user, doctorProfile };
    });
    if (!result) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    const { profileImageBytes, ...safeDoctorProfile } = result.doctorProfile;
    return res.json({ success: true, user: result.user, profile: { ...safeDoctorProfile, user: result.user, hasProfileImage: Boolean(profileImageBytes) } });
  } catch (error) {
    return next(error);
  }
});

router.get('/me/profile-image', authenticate, requireRole('DOCTOR'), async (req, res, next) => {
  try {
    const profile = await prisma.doctorProfile.findUnique({
      where: { userId: req.auth.userId },
      select: { profileImageBytes: true, profileImageContentType: true },
    });
    if (!profile) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    if (!profile.profileImageBytes || !profile.profileImageContentType) return res.status(404).json({ success: false, message: 'No profile image has been uploaded.' });
    res.set('Content-Type', profile.profileImageContentType);
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.send(profile.profileImageBytes);
  } catch (error) {
    return next(error);
  }
});

router.put('/me/profile-image', authenticate, requireRole('DOCTOR'), parseProfileImage, async (req, res, next) => {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!allowedProfileImageTypes.has(contentType) || !hasValidImageSignature(req.body, contentType)) {
    return res.status(400).json({ success: false, message: 'Upload a valid PNG, JPEG, or WebP image.' });
  }
  try {
    const profile = await prisma.doctorProfile.updateMany({
      where: { userId: req.auth.userId },
      data: { profileImageBytes: req.body, profileImageContentType: contentType },
    });
    if (!profile.count) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    return res.json({ success: true, hasProfileImage: true });
  } catch (error) {
    return next(error);
  }
});

router.delete('/me/profile-image', authenticate, requireRole('DOCTOR'), async (req, res, next) => {
  try {
    const profile = await prisma.doctorProfile.updateMany({
      where: { userId: req.auth.userId },
      data: { profileImageBytes: null, profileImageContentType: null },
    });
    if (!profile.count) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    return res.json({ success: true, hasProfileImage: false });
  } catch (error) {
    return next(error);
  }
});

router.get('/me/summary', authenticate, requireRole('DOCTOR'), async (req, res, next) => {
  try {
    const profile = await prisma.doctorProfile.findUnique({ where: { userId: req.auth.userId }, select: { id: true } });
    if (!profile) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    const today = lagosDateKey();
    const dayStart = new Date(`${today}T00:00:00+01:00`);
    const nextDay = new Date(dayStart.getTime() + 86_400_000);
    const now = new Date();
    const appointmentInclude = { patient: { select: { id: true, name: true } } };
    const [todayAppointments, completedToday, upcomingCount, upcomingAppointments, unreadNotifications] = await prisma.$transaction([
      prisma.appointment.findMany({
        where: { doctorId: profile.id, startAt: { gte: dayStart, lt: nextDay } },
        include: appointmentInclude,
        orderBy: { startAt: 'asc' },
      }),
      prisma.appointment.count({ where: { doctorId: profile.id, status: 'COMPLETED', startAt: { gte: dayStart, lt: nextDay } } }),
      prisma.appointment.count({ where: { doctorId: profile.id, status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { gte: now } } }),
      prisma.appointment.findMany({
        where: { doctorId: profile.id, status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { gte: now } },
        include: appointmentInclude,
        orderBy: { startAt: 'asc' },
        take: 5,
      }),
      prisma.notification.count({ where: { userId: req.auth.userId, read: false } }),
    ]);
    return res.json({
      success: true,
      date: today,
      today: {
        total: todayAppointments.length,
        scheduled: todayAppointments.filter((item) => ['PENDING', 'CONFIRMED'].includes(item.status)).length,
        completed: completedToday,
        noShow: todayAppointments.filter((item) => item.status === 'NO_SHOW').length,
      },
      upcomingCount,
      unreadNotifications,
      todayAppointments,
      upcomingAppointments,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/me/patients', authenticate, requireRole('DOCTOR'), async (req, res, next) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = 20;
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  try {
    const profile = await prisma.doctorProfile.findUnique({ where: { userId: req.auth.userId }, select: { id: true } });
    if (!profile) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    const where = {
      role: 'PATIENT',
      patientAppointments: { some: { doctorId: profile.id, status: { not: 'CANCELLED' } } },
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };
    const [patients, total] = await prisma.$transaction([
      prisma.user.findMany({ where, select: { id: true, name: true }, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.user.count({ where }),
    ]);
    const patientIds = patients.map((patient) => patient.id);
    const [visitStats, upcoming] = patientIds.length ? await Promise.all([
      prisma.appointment.groupBy({
        by: ['patientId'],
        where: { doctorId: profile.id, patientId: { in: patientIds }, status: 'COMPLETED' },
        _count: { _all: true },
        _max: { startAt: true },
      }),
      prisma.appointment.findMany({
        where: { doctorId: profile.id, patientId: { in: patientIds }, status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { gte: new Date() } },
        select: { patientId: true, startAt: true },
        orderBy: { startAt: 'asc' },
      }),
    ]) : [[], []];
    const statsByPatient = new Map(visitStats.map((stat) => [stat.patientId, stat]));
    const nextByPatient = new Map();
    for (const appointment of upcoming) if (!nextByPatient.has(appointment.patientId)) nextByPatient.set(appointment.patientId, appointment.startAt);
    return res.json({
      success: true,
      patients: patients.map((patient) => {
        const stats = statsByPatient.get(patient.id);
        return {
          ...patient,
          completedVisits: stats?._count._all || 0,
          lastVisitAt: stats?._max.startAt || null,
          nextAppointmentAt: nextByPatient.get(patient.id) || null,
        };
      }),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/me/patients/:patientId', authenticate, requireRole('DOCTOR'), async (req, res, next) => {
  try {
    const profile = await prisma.doctorProfile.findUnique({ where: { userId: req.auth.userId }, select: { id: true } });
    if (!profile) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    const patient = await prisma.user.findFirst({
      where: {
        id: req.params.patientId,
        role: 'PATIENT',
        patientAppointments: { some: { doctorId: profile.id, status: { not: 'CANCELLED' } } },
      },
      select: { id: true, name: true },
    });
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found in your appointment history.' });
    const appointments = await prisma.appointment.findMany({
      where: { doctorId: profile.id, patientId: patient.id },
      select: { id: true, startAt: true, endAt: true, status: true, confirmationStatus: true, reason: true },
      orderBy: { startAt: 'desc' },
      take: 50,
    });
    return res.json({ success: true, patient, appointments });
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
