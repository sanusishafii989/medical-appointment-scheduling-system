const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { hashActionToken } = require('../lib/action-tokens');
const { sendDoctorActionNotice } = require('../services/mail');
const { formatAppointmentTime } = require('../services/appointment-notifications');
const { offerNextWaitlist } = require('../services/waitlist');

const router = Router();
const actionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.' },
});
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const previewSchema = z.object({ token: tokenSchema });
const actionSchema = z.object({ token: tokenSchema, action: z.enum(['confirm', 'cancel']) });
const appointmentView = {
  patient: { select: { isActive: true } },
  doctor: {
    select: {
      id: true,
      specialization: true,
      department: { select: { name: true } },
      user: { select: { name: true } },
    },
  },
};
const actionAppointmentInclude = {
  doctor: {
    include: {
      user: { select: { id: true, name: true, email: true } },
      department: { select: { name: true } },
    },
  },
  patient: { select: { id: true, name: true, isActive: true } },
};

function publicSummary(appointment) {
  return {
    appointment: {
      id: appointment.id,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      status: appointment.status,
      confirmationStatus: appointment.confirmationStatus,
      doctor: {
        id: appointment.doctor.id,
        specialization: appointment.doctor.specialization,
        department: appointment.doctor.department,
        user: { name: appointment.doctor.user.name },
      },
    },
    canConfirm: appointment.status === 'PENDING' && appointment.startAt > new Date(),
    canCancel: ['PENDING', 'CONFIRMED'].includes(appointment.status)
      && appointment.startAt.getTime() - Date.now() >= 2 * 60 * 60 * 1000,
  };
}

router.post('/preview', actionLimiter, async (req, res, next) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'This appointment link is invalid.' });
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { actionToken: hashActionToken(parsed.data.token) },
      include: appointmentView,
    });
    if (!appointment) return res.status(404).json({ success: false, message: 'This appointment link is invalid or expired.' });
    if (!appointment.patient.isActive) return res.status(404).json({ success: false, message: 'This appointment link is invalid or expired.' });
    return res.json({ success: true, ...publicSummary(appointment) });
  } catch (error) {
    return next(error);
  }
});

router.post('/', actionLimiter, async (req, res, next) => {
  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'This appointment action is invalid.' });
  const tokenHash = hashActionToken(parsed.data.token);
  const { action } = parsed.data;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { actionToken: tokenHash },
        include: actionAppointmentInclude,
      });
      if (!appointment) return { error: 'This appointment link is invalid or expired.', status: 404 };
      if (!appointment.patient.isActive) return { error: 'This appointment link is invalid or expired.', status: 404 };
      if (action === 'confirm') {
        if (appointment.status === 'CONFIRMED' && appointment.confirmationStatus === 'CONFIRMED_BY_PATIENT') {
          return { appointment, alreadyDone: true };
        }
        if (appointment.status !== 'PENDING' || appointment.startAt <= new Date()) {
          return { error: 'This appointment can no longer be confirmed.', status: 409 };
        }
        const changed = await tx.appointment.updateMany({
          where: { id: appointment.id, actionToken: tokenHash, status: 'PENDING' },
          data: { status: 'CONFIRMED', confirmationStatus: 'CONFIRMED_BY_PATIENT', confirmedAt: new Date() },
        });
        if (!changed.count) return { error: 'The appointment changed. Refresh this page to see its current status.', status: 409 };
        await tx.notification.create({
          data: { userId: appointment.doctor.user.id, appointmentId: appointment.id, title: 'Patient confirmed appointment', message: `${appointment.patient.name} confirmed the appointment scheduled for ${formatAppointmentTime(appointment.startAt)} Nigeria time.` },
        });
      } else {
        if (appointment.status === 'CANCELLED') return { appointment, alreadyDone: true };
        if (!['PENDING', 'CONFIRMED'].includes(appointment.status)) {
          return { error: 'This appointment can no longer be cancelled.', status: 409 };
        }
        if (appointment.startAt.getTime() - Date.now() < 2 * 60 * 60 * 1000) {
          return { error: 'Appointments can be cancelled at least two hours before they start.', status: 400 };
        }
        const changed = await tx.appointment.updateMany({
          where: { id: appointment.id, actionToken: tokenHash, status: { in: ['PENDING', 'CONFIRMED'] } },
          data: { status: 'CANCELLED' },
        });
        if (!changed.count) return { error: 'The appointment changed. Refresh this page to see its current status.', status: 409 };
        await tx.reminder.updateMany({
          where: { appointmentId: appointment.id, status: { in: ['PENDING', 'FAILED'] } },
          data: { status: 'CANCELLED' },
        });
        await tx.notification.create({
          data: { userId: appointment.doctor.user.id, appointmentId: appointment.id, title: 'Patient cancelled appointment', message: `${appointment.patient.name} cancelled the appointment scheduled for ${formatAppointmentTime(appointment.startAt)} Nigeria time.` },
        });
      }
      const updated = await tx.appointment.findUnique({
        where: { id: appointment.id },
        include: actionAppointmentInclude,
      });
      return { appointment: updated };
    });
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    if (!result.alreadyDone) {
      if (action === 'cancel') {
        offerNextWaitlist(prisma, result.appointment.doctor.id, result.appointment.startAt)
          .catch((error) => console.error(`Could not process waitlist after appointment ${result.appointment.id} was cancelled: ${error.message}`));
      }
      sendDoctorActionNotice(result.appointment, action === 'confirm' ? 'CONFIRMED' : 'CANCELLED')
        .catch((error) => console.error(`Could not email doctor about appointment ${result.appointment.id}: ${error.message}`));
    }
    return res.json({ success: true, message: result.alreadyDone ? 'This action has already been recorded.' : `Appointment ${action === 'confirm' ? 'confirmed' : 'cancelled'}.`, ...publicSummary(result.appointment) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
