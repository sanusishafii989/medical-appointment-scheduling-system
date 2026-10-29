const { Router } = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/authenticate');
const { findAvailabilityForStart, isSlotOpen, parseDateOnly, lagosDateTime } = require('../services/scheduling');
const { createActionToken } = require('../lib/action-tokens');
const { createBookingNotifications, replaceAppointmentReminders, formatAppointmentTime } = require('../services/appointment-notifications');
const { sendBookingConfirmation, sendDoctorActionNotice, createCalendar } = require('../services/mail');
const { offerNextWaitlist } = require('../services/waitlist');

const router = Router();
const bookingSchema = z.object({
  doctorId: z.string().min(1),
  startAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().max(500).optional().or(z.literal('')),
});
const rescheduleSchema = z.object({ startAt: z.string().datetime({ offset: true }) });

function safeAppointment(appointment) {
  return {
    id: appointment.id,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: appointment.status,
    confirmationStatus: appointment.confirmationStatus,
    reason: appointment.reason,
    doctor: appointment.doctor && {
      id: appointment.doctor.id,
      specialization: appointment.doctor.specialization,
      department: appointment.doctor.department,
      user: { name: appointment.doctor.user.name },
    },
    patient: appointment.patient && { id: appointment.patient.id, name: appointment.patient.name },
  };
}

const appointmentInclude = {
  doctor: {
    select: {
      id: true,
      specialization: true,
      department: { select: { name: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  },
  patient: {
    select: {
      id: true,
      name: true,
      email: true,
      notificationPreference: { select: { emailEnabled: true, inAppEnabled: true } },
    },
  },
};

router.use(authenticate);

router.get('/:appointmentId/calendar.ics', requireRole('PATIENT'), async (req, res, next) => {
  try {
    const appointment = await prisma.appointment.findFirst({
      where: { id: req.params.appointmentId, patientId: req.auth.userId },
      include: appointmentInclude,
    });
    if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found.' });
    const calendar = createCalendar(appointment);
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="careslot-appointment-${appointment.id}.ics"`);
    return res.send(calendar);
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireRole('PATIENT'), async (req, res, next) => {
  const parsed = bookingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Provide a doctor, a valid ISO appointment time, and an optional reason.', errors: parsed.error.issues });
  }
  const startAt = new Date(parsed.data.startAt);
  if (startAt <= new Date()) return res.status(400).json({ success: false, message: 'Choose a future appointment time.' });
  const actionToken = createActionToken();

  try {
    const availability = await findAvailabilityForStart(prisma, parsed.data.doctorId, startAt);
    if (!availability) return res.status(400).json({ success: false, message: 'That time is outside the doctor’s published availability.' });
    const endAt = new Date(startAt.getTime() + availability.slotMinutes * 60_000);
    const appointment = await prisma.$transaction(async (tx) => {
      if (!await isSlotOpen(tx, parsed.data.doctorId, startAt, availability.slotMinutes)) {
        const conflict = new Error('That appointment time was just booked. Choose another slot.');
        conflict.status = 409;
        throw conflict;
      }
      const created = await tx.appointment.create({
        data: {
          patientId: req.auth.userId,
          doctorId: parsed.data.doctorId,
          startAt,
          endAt,
          status: 'PENDING',
          confirmationStatus: 'UNCONFIRMED',
          actionToken: actionToken.tokenHash,
          reason: parsed.data.reason || null,
        },
        include: appointmentInclude,
      });
      await createBookingNotifications(tx, created, created.patient.notificationPreference);
      return created;
    }, { isolationLevel: 'Serializable' });
    let emailSent = false;
    if (appointment.patient.notificationPreference?.emailEnabled ?? true) {
      try {
        await sendBookingConfirmation(appointment, actionToken.token);
        emailSent = true;
      } catch (error) {
        console.error(`Could not send booking confirmation for appointment ${appointment.id}: ${error.message}`);
      }
    }
    return res.status(201).json({ success: true, appointment: safeAppointment(appointment), emailSent });
  } catch (error) {
    if (error.code === 'P2002' || error.code === 'P2034') {
      return res.status(409).json({ success: false, message: 'That appointment time was just booked. Choose another slot.' });
    }
    if (error.status === 409) return res.status(409).json({ success: false, message: error.message });
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = req.auth.role === 'DOCTOR' && req.query.date ? 100 : 20;
  const statusValues = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];
  if (req.query.status && !statusValues.includes(req.query.status)) {
    return res.status(400).json({ success: false, message: 'Choose a valid appointment status.' });
  }
  let dateRange;
  if (req.query.date !== undefined) {
    const parsedDate = parseDateOnly(req.query.date);
    if (!parsedDate) return res.status(400).json({ success: false, message: 'Provide a date in YYYY-MM-DD format.' });
    const nextDay = new Date(parsedDate.date.getTime() + 86_400_000);
    dateRange = {
      gte: lagosDateTime(parsedDate, '00:00'),
      lt: lagosDateTime({ year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1, day: nextDay.getUTCDate() }, '00:00'),
    };
  }
  const where = req.auth.role === 'PATIENT'
    ? { patientId: req.auth.userId }
    : req.auth.role === 'DOCTOR'
      ? { doctor: { userId: req.auth.userId } }
      : {};
  if (req.query.status) where.status = req.query.status;
  if (dateRange) where.startAt = dateRange;
  try {
    const [appointments, total] = await prisma.$transaction([
      prisma.appointment.findMany({
        where,
        include: appointmentInclude,
        orderBy: { startAt: req.auth.role === 'DOCTOR' && dateRange ? 'asc' : 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.appointment.count({ where }),
    ]);
    return res.json({ success: true, appointments: appointments.map(safeAppointment), pagination: { page, pageSize, total } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:appointmentId/outcome', requireRole('DOCTOR'), async (req, res, next) => {
  const parsed = z.object({ status: z.enum(['COMPLETED', 'NO_SHOW']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Choose completed or no-show as the visit outcome.' });
  try {
    const appointment = await prisma.appointment.findFirst({
      where: { id: req.params.appointmentId, doctor: { userId: req.auth.userId } },
      include: appointmentInclude,
    });
    if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found.' });
    if (!['PENDING', 'CONFIRMED'].includes(appointment.status)) {
      return res.status(409).json({ success: false, message: 'This appointment already has a final status.' });
    }
    if (appointment.endAt > new Date()) {
      return res.status(400).json({ success: false, message: 'A visit outcome can be recorded after the appointment has ended.' });
    }
    const changed = await prisma.appointment.updateMany({
      where: { id: appointment.id, doctor: { userId: req.auth.userId }, status: { in: ['PENDING', 'CONFIRMED'] } },
      data: { status: parsed.data.status },
    });
    if (!changed.count) return res.status(409).json({ success: false, message: 'This appointment was updated. Refresh the schedule.' });
    const updated = await prisma.appointment.findUnique({ where: { id: appointment.id }, include: appointmentInclude });
    return res.json({ success: true, appointment: safeAppointment(updated) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:appointmentId/cancel', async (req, res, next) => {
  try {
    const appointment = await prisma.appointment.findUnique({ where: { id: req.params.appointmentId } });
    if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found.' });
    if (req.auth.role !== 'ADMIN' && appointment.patientId !== req.auth.userId) {
      return res.status(403).json({ success: false, message: 'You can only cancel your own appointment.' });
    }
    if (!['PENDING', 'CONFIRMED'].includes(appointment.status)) {
      return res.status(409).json({ success: false, message: 'This appointment can no longer be cancelled.' });
    }
    if (appointment.startAt.getTime() - Date.now() < 2 * 60 * 60 * 1000) {
      return res.status(400).json({ success: false, message: 'Appointments can be cancelled at least two hours before they start.' });
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.reminder.updateMany({ where: { appointmentId: appointment.id, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'CANCELLED' } });
      const cancelled = await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'CANCELLED' }, include: appointmentInclude });
      await tx.notification.create({
        data: { userId: cancelled.doctor.user.id, appointmentId: cancelled.id, title: 'Patient cancelled appointment', message: `${cancelled.patient.name} cancelled the appointment scheduled for ${formatAppointmentTime(cancelled.startAt)} Nigeria time.` },
      });
      return cancelled;
    });
    offerNextWaitlist(prisma, appointment.doctorId, appointment.startAt)
      .catch((error) => console.error(`Could not process waitlist for cancelled appointment ${appointment.id}: ${error.message}`));
    sendDoctorActionNotice(updated, 'CANCELLED').catch((error) => console.error(`Could not email doctor about appointment ${updated.id}: ${error.message}`));
    return res.json({ success: true, appointment: safeAppointment(updated) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:appointmentId/reschedule', requireRole('PATIENT'), async (req, res, next) => {
  const parsed = rescheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Provide a valid ISO appointment time.' });
  const newStartAt = new Date(parsed.data.startAt);
  if (newStartAt <= new Date()) return res.status(400).json({ success: false, message: 'Choose a future appointment time.' });

  try {
    const appointment = await prisma.appointment.findUnique({ where: { id: req.params.appointmentId } });
    if (!appointment || appointment.patientId !== req.auth.userId) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }
    if (appointment.startAt.getTime() === newStartAt.getTime()) {
      return res.status(400).json({ success: false, message: 'Choose a different appointment time.' });
    }
    if (!['PENDING', 'CONFIRMED'].includes(appointment.status)) {
      return res.status(409).json({ success: false, message: 'This appointment can no longer be rescheduled.' });
    }
    if (appointment.startAt.getTime() - Date.now() < 2 * 60 * 60 * 1000) {
      return res.status(400).json({ success: false, message: 'Appointments can be rescheduled at least two hours before they start.' });
    }
    const availability = await findAvailabilityForStart(prisma, appointment.doctorId, newStartAt);
    if (!availability) return res.status(400).json({ success: false, message: 'That time is outside the doctor’s published availability.' });
    const newEndAt = new Date(newStartAt.getTime() + availability.slotMinutes * 60_000);
    const actionToken = createActionToken();

    const updated = await prisma.$transaction(async (tx) => {
      if (!await isSlotOpen(tx, appointment.doctorId, newStartAt, availability.slotMinutes, appointment.id)) {
        const conflict = new Error('That appointment time was just booked. Choose another slot.');
        conflict.status = 409;
        throw conflict;
      }
      const updated = await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          startAt: newStartAt,
          endAt: newEndAt,
          status: 'PENDING',
          confirmationStatus: 'UNCONFIRMED',
          confirmedAt: null,
          actionToken: actionToken.tokenHash,
        },
        include: appointmentInclude,
      });
      await replaceAppointmentReminders(tx, updated, updated.patient.notificationPreference);
      await tx.notification.create({
        data: { userId: updated.patientId, appointmentId: updated.id, title: 'Appointment rescheduled', message: `Your appointment with ${updated.doctor.user.name} is now scheduled for ${formatAppointmentTime(updated.startAt)} Nigeria time.` },
      });
      return updated;
    }, { isolationLevel: 'Serializable' });
    offerNextWaitlist(prisma, appointment.doctorId, appointment.startAt)
      .catch((error) => console.error(`Could not process waitlist after rescheduling appointment ${appointment.id}: ${error.message}`));
    let emailSent = false;
    if (updated.patient.notificationPreference?.emailEnabled ?? true) {
      try {
        await sendBookingConfirmation(updated, actionToken.token, true);
        emailSent = true;
      } catch (error) {
        console.error(`Could not send rescheduling email for appointment ${updated.id}: ${error.message}`);
      }
    }
    return res.json({ success: true, appointment: safeAppointment(updated), emailSent });
  } catch (error) {
    if (error.code === 'P2002' || error.code === 'P2034') {
      return res.status(409).json({ success: false, message: 'That appointment time was just booked. Choose another slot.' });
    }
    if (error.status === 409) return res.status(409).json({ success: false, message: error.message });
    return next(error);
  }
});

module.exports = router;
