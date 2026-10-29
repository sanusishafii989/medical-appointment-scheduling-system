const { Router } = require('express');
const { authenticate, requireRole } = require('../middleware/authenticate');
const { parseDateOnly, lagosDateTime } = require('../services/scheduling');
const prisma = require('../lib/prisma');

const router = Router();
const STATUSES = ['PENDING', 'SENT', 'FAILED', 'CANCELLED'];
const TYPES = ['EMAIL', 'IN_APP'];
const PAGE_SIZE = 25;

function getDateRange(query) {
  if (!query.from && !query.to) return undefined;
  const from = typeof query.from === 'string' ? query.from : query.to;
  const to = typeof query.to === 'string' ? query.to : query.from;
  const fromDate = parseDateOnly(from);
  const toDate = parseDateOnly(to);
  if (!fromDate || !toDate || fromDate.date > toDate.date) return null;
  const days = (toDate.date.getTime() - fromDate.date.getTime()) / 86_400_000 + 1;
  if (days > 366) return null;
  const nextDay = new Date(toDate.date.getTime() + 86_400_000);
  return {
    gte: lagosDateTime(fromDate, '00:00'),
    lt: lagosDateTime({ year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1, day: nextDay.getUTCDate() }, '00:00'),
  };
}

router.use(authenticate, requireRole('ADMIN'));

router.get('/', async (req, res, next) => {
  if (req.query.status && !STATUSES.includes(req.query.status)) {
    return res.status(400).json({ success: false, message: 'Choose a valid reminder status.' });
  }
  if (req.query.type && !TYPES.includes(req.query.type)) {
    return res.status(400).json({ success: false, message: 'Choose a valid reminder channel.' });
  }
  const scheduledFor = getDateRange(req.query);
  if (scheduledFor === null) {
    return res.status(400).json({ success: false, message: 'Choose a valid date range of no more than 366 days.' });
  }
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const where = {
    ...(req.query.status ? { status: req.query.status } : {}),
    ...(req.query.type ? { type: req.query.type } : {}),
    ...(scheduledFor ? { scheduledFor } : {}),
  };

  try {
    const [records, total] = await prisma.$transaction([
      prisma.reminder.findMany({
        where,
        include: {
          appointment: {
            select: {
              startAt: true,
              patient: { select: { name: true } },
              doctor: { select: { user: { select: { name: true } } } },
            },
          },
        },
        orderBy: { scheduledFor: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.reminder.count({ where }),
    ]);
    const reminders = records.map((reminder) => ({
      id: reminder.id,
      type: reminder.type,
      scheduledFor: reminder.scheduledFor,
      sentAt: reminder.sentAt,
      status: reminder.status,
      attempts: reminder.attempts,
      errorMessage: reminder.errorMessage?.slice(0, 500) || null,
      appointment: {
        startAt: reminder.appointment.startAt,
        patientName: reminder.appointment.patient.name,
        doctorName: reminder.appointment.doctor.user.name,
      },
    }));
    return res.json({ success: true, reminders, pagination: { page, pageSize: PAGE_SIZE, total } });
  } catch (error) { return next(error); }
});

module.exports = router;
