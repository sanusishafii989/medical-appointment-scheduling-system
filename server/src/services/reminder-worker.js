const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { sendReminderEmail } = require('./mail');

let running = false;

function retryDelayMs(attempts) {
  return attempts <= 1 ? 5 * 60_000 : 15 * 60_000;
}

async function deliverInApp(reminder) {
  const appointment = reminder.appointment;
  await prisma.$transaction(async (tx) => {
    const updated = await tx.reminder.updateMany({
      where: { id: reminder.id, status: 'FAILED', attempts: reminder.attempts + 1 },
      data: { status: 'SENT', sentAt: new Date(), errorMessage: null },
    });
    if (!updated.count) return;
    await tx.notification.create({
      data: {
        userId: appointment.patientId,
        appointmentId: appointment.id,
        title: 'Appointment reminder',
        message: `Your appointment with ${appointment.doctor.user.name} is scheduled for ${new Intl.DateTimeFormat('en-NG', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(appointment.startAt)} Nigeria time.`,
      },
    });
  });
}

async function processReminder(reminder) {
  const claim = await prisma.reminder.updateMany({
    where: {
      id: reminder.id,
      status: reminder.status,
      attempts: reminder.attempts,
      updatedAt: reminder.updatedAt,
    },
    data: { status: 'FAILED', attempts: { increment: 1 }, errorMessage: null },
  });
  if (!claim.count) return;
  const attempt = reminder.attempts + 1;

  try {
    const current = await prisma.reminder.findUnique({
      where: { id: reminder.id },
      select: { status: true, appointment: { select: { status: true } } },
    });
    if (!current || current.status !== 'FAILED') return;
    if (!['PENDING', 'CONFIRMED'].includes(current.appointment.status)) {
      await prisma.reminder.updateMany({ where: { id: reminder.id, status: 'FAILED', attempts: attempt }, data: { status: 'CANCELLED' } });
      return;
    }
    if (reminder.type === 'EMAIL') await sendReminderEmail(reminder.appointment);
    else await deliverInApp(reminder);
    if (reminder.type === 'EMAIL') {
      await prisma.reminder.updateMany({
        where: { id: reminder.id, status: 'FAILED', attempts: attempt },
        data: { status: 'SENT', sentAt: new Date(), errorMessage: null },
      });
    }
  } catch (error) {
    await prisma.reminder.updateMany({
      where: { id: reminder.id, status: 'FAILED', attempts: attempt },
      data: { errorMessage: String(error.message || 'Delivery failed').slice(0, 500) },
    });
    console.error(`Reminder ${reminder.id} delivery failed on attempt ${attempt}: ${error.message}`);
  }
}

async function processDueReminders() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const reminders = await prisma.reminder.findMany({
      where: {
        scheduledFor: { lte: now },
        appointment: { status: { in: ['PENDING', 'CONFIRMED'] } },
        OR: [
          { status: 'PENDING' },
          { status: 'FAILED', attempts: { lt: 3 } },
        ],
      },
      include: {
        appointment: {
          include: {
            patient: { select: { id: true, name: true, email: true } },
            doctor: { include: { user: { select: { name: true } } } },
          },
        },
      },
      orderBy: { scheduledFor: 'asc' },
      take: 100,
    });
    for (const reminder of reminders) {
      if (reminder.status === 'FAILED') {
        const eligibleAt = reminder.updatedAt.getTime() + retryDelayMs(reminder.attempts);
        if (eligibleAt > now.getTime()) continue;
      }
      await processReminder(reminder);
    }
  } catch (error) {
    console.error('Reminder worker failed:', error.message);
  } finally {
    running = false;
  }
}

function startReminderScheduler() {
  processDueReminders();
  return cron.schedule('* * * * *', processDueReminders);
}

module.exports = { processDueReminders, startReminderScheduler };
