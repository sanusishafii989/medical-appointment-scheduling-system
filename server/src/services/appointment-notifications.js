function reminderEntries(appointment, preference) {
  const channels = [];
  if (preference?.emailEnabled ?? true) channels.push('EMAIL');
  if (preference?.inAppEnabled ?? true) channels.push('IN_APP');
  const offsets = [24 * 60 * 60 * 1000, 2 * 60 * 60 * 1000];
  const now = new Date();
  return offsets.flatMap((offset) => {
    const scheduledFor = new Date(appointment.startAt.getTime() - offset);
    if (scheduledFor <= now) return [];
    return channels.map((type) => ({ appointmentId: appointment.id, type, scheduledFor }));
  });
}

function formatAppointmentTime(value) {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(value);
}

async function createBookingNotifications(tx, appointment, preference) {
  await tx.notification.create({
    data: {
      userId: appointment.patientId,
      appointmentId: appointment.id,
      title: 'Appointment booked',
      message: `Your appointment with ${appointment.doctor.user.name} is booked for ${formatAppointmentTime(appointment.startAt)} Nigeria time.`,
    },
  });
  const reminders = reminderEntries(appointment, preference);
  if (reminders.length) await tx.reminder.createMany({ data: reminders, skipDuplicates: true });
}

async function replaceAppointmentReminders(tx, appointment, preference) {
  await tx.reminder.updateMany({
    where: { appointmentId: appointment.id, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'CANCELLED' },
  });
  const reminders = reminderEntries(appointment, preference);
  for (const reminder of reminders) {
    await tx.reminder.upsert({
      where: {
        appointmentId_type_scheduledFor: {
          appointmentId: reminder.appointmentId,
          type: reminder.type,
          scheduledFor: reminder.scheduledFor,
        },
      },
      update: { status: 'PENDING', sentAt: null, attempts: 0, errorMessage: null },
      create: reminder,
    });
  }
}

module.exports = { createBookingNotifications, replaceAppointmentReminders, formatAppointmentTime };
