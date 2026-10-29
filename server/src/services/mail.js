const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (transporter !== undefined) return transporter;
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!host || !from) {
    transporter = null;
    return transporter;
  }
  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
    ...(process.env.SMTP_USER && process.env.SMTP_PASS
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
      : {}),
  });
  return transporter;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatNigeriaTime(value) {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(value);
}

function icsEscape(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function icsDate(value) {
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function createCalendar(appointment) {
  const doctorName = appointment.doctor.user.name;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CareSlot//Medical Appointment//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${appointment.id}@careslot`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(appointment.startAt)}`,
    `DTEND:${icsDate(appointment.endAt)}`,
    `SUMMARY:${icsEscape(`Medical appointment with ${doctorName}`)}`,
    `DESCRIPTION:${icsEscape(`Appointment with ${doctorName}. Times are in Africa/Lagos.`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ];
  return lines.join('\r\n');
}

function actionUrl(token) {
  const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${clientUrl}/appointment-action#token=${encodeURIComponent(token)}`;
}

async function sendEmail({ to, subject, text, html, attachments }) {
  const transport = getTransporter();
  if (!transport) throw new Error('SMTP is not configured. Add SMTP_HOST and EMAIL_FROM to server/.env.');
  return transport.sendMail({
    from: process.env.EMAIL_FROM.trim(),
    to,
    subject,
    text,
    html,
    attachments,
  });
}

async function sendBookingConfirmation(appointment, token, updated = false) {
  const doctorName = appointment.doctor.user.name;
  const date = formatNigeriaTime(appointment.startAt);
  const url = actionUrl(token);
  const safePatient = escapeHtml(appointment.patient.name);
  const safeDoctor = escapeHtml(doctorName);
  const safeDate = escapeHtml(date);
  const safeUrl = escapeHtml(url);
  await sendEmail({
    to: appointment.patient.email,
    subject: updated ? 'Your CareSlot appointment was updated' : 'Your CareSlot appointment is booked',
    text: `Hello ${appointment.patient.name}, your appointment with ${doctorName} is ${updated ? 'now scheduled' : 'booked'} for ${date} Nigeria time. View the appointment and confirm or cancel here: ${url}`,
    html: `<p>Hello ${safePatient},</p><p>Your appointment with <strong>${safeDoctor}</strong> is ${updated ? 'now scheduled' : 'booked'} for ${safeDate} Nigeria time.</p><p><a href="${safeUrl}">View appointment and confirm or cancel</a></p><p>${updated ? 'An updated calendar file' : 'A calendar file'} is attached. Please do not reply with private medical details.</p>`,
    attachments: [{ filename: 'careslot-appointment.ics', content: createCalendar(appointment), contentType: 'text/calendar; charset=utf-8' }],
  });
}

async function sendReminderEmail(appointment) {
  const doctorName = appointment.doctor.user.name;
  const date = formatNigeriaTime(appointment.startAt);
  const safePatient = escapeHtml(appointment.patient.name);
  const safeDoctor = escapeHtml(doctorName);
  const safeDate = escapeHtml(date);
  await sendEmail({
    to: appointment.patient.email,
    subject: 'Reminder: your CareSlot appointment',
    text: `Hello ${appointment.patient.name}, this is a reminder about your appointment with ${doctorName} on ${date} Nigeria time.`,
    html: `<p>Hello ${safePatient},</p><p>This is a reminder about your appointment with <strong>${safeDoctor}</strong> on ${safeDate} Nigeria time.</p><p>Please sign in to manage the appointment.</p>`,
  });
}

async function sendDoctorActionNotice(appointment, action) {
  const doctor = appointment.doctor.user;
  const date = formatNigeriaTime(appointment.startAt);
  const actionText = action === 'CONFIRMED' ? 'confirmed' : 'cancelled';
  const patientName = escapeHtml(appointment.patient.name);
  const doctorName = escapeHtml(doctor.name);
  const safeDate = escapeHtml(date);
  await sendEmail({
    to: doctor.email,
    subject: `Patient ${actionText} an appointment`,
    text: `${appointment.patient.name} ${actionText} their appointment with you scheduled for ${date} Nigeria time.`,
    html: `<p>Hello ${doctorName},</p><p>${patientName} ${actionText} an appointment scheduled for ${safeDate} Nigeria time.</p>`,
  });
}

async function sendWaitlistOffer(entry, token) {
  const doctorName = entry.doctor.user.name;
  const date = formatNigeriaTime(entry.offeredStartAt);
  const expires = formatNigeriaTime(entry.offerExpiresAt);
  const url = `${(process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '')}/waitlist-claim#claim=${encodeURIComponent(token)}`;
  await sendEmail({
    to: entry.patient.email,
    subject: 'A CareSlot appointment is available from the waitlist',
    text: `A slot with ${doctorName} is available for ${date} Nigeria time. Claim it before ${expires} Nigeria time: ${url}`,
    html: `<p>A slot with <strong>${escapeHtml(doctorName)}</strong> is available for ${escapeHtml(date)} Nigeria time.</p><p>This offer expires at ${escapeHtml(expires)} Nigeria time.</p><p><a href="${escapeHtml(url)}">Review and claim this appointment</a></p><p>If you do not claim in time, the slot will be offered to the next patient.</p>`,
  });
}

module.exports = { sendBookingConfirmation, sendReminderEmail, sendDoctorActionNotice, sendWaitlistOffer, createCalendar };
