const { createActionToken } = require('../lib/action-tokens');
const { findAvailabilityForStart, isSlotOpen, parseDateOnly, lagosDateString } = require('./scheduling');
const { createBookingNotifications } = require('./appointment-notifications');
const { sendBookingConfirmation, sendWaitlistOffer } = require('./mail');

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

const waitlistInclude = {
  patient: { select: { id: true, name: true, email: true, isActive: true, notificationPreference: { select: { emailEnabled: true, inAppEnabled: true } } } },
  doctor: {
    include: {
      user: { select: { name: true } },
      department: { select: { name: true } },
    },
  },
};

async function offerNextWaitlist(prisma, doctorId, startAt) {
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) return null;
  const localDate = lagosDateString(startAt);
  const dateParts = parseDateOnly(localDate);
  if (!dateParts) return null;
  const date = dateParts.date;
  let offered;
  try {
    offered = await prisma.$transaction(async (tx) => {
      const availability = await findAvailabilityForStart(tx, doctorId, startAt);
      if (!availability || !await isSlotOpen(tx, doctorId, startAt, availability.slotMinutes)) return null;
      const activeOffer = await tx.waitlist.findFirst({
        where: { doctorId, status: 'NOTIFIED', offeredStartAt: startAt, offerExpiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (activeOffer) return null;
      const candidate = await tx.waitlist.findFirst({
        where: { doctorId, date, status: 'WAITING', patient: { isActive: true } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, patientId: true },
      });
      if (!candidate) return null;

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 60_000);
      const token = createActionToken();
      const updated = await tx.waitlist.updateMany({
        where: { id: candidate.id, status: 'WAITING' },
        data: {
          status: 'NOTIFIED',
          claimToken: token.tokenHash,
          notifiedAt: now,
          offeredStartAt: startAt,
          offerExpiresAt: expiresAt,
        },
      });
      if (!updated.count) return null;
      const entry = await tx.waitlist.findUnique({ where: { id: candidate.id }, include: waitlistInclude });
      await tx.notification.create({
        data: {
          userId: entry.patientId,
          title: 'An appointment slot is available',
          message: `A ${entry.doctor.user.name} appointment is available for ${new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(startAt)} Nigeria time. Claim it within 30 minutes from your appointments page.`,
        },
      });
      return { entry, token: token.token };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2002' || error.code === 'P2034') return null;
    throw error;
  }

  if (offered && (offered.entry.patient.notificationPreference?.emailEnabled ?? true)) {
    sendWaitlistOffer(offered.entry, offered.token)
      .catch((error) => console.error(`Could not email waitlist offer ${offered.entry.id}: ${error.message}`));
  }
  return offered?.entry || null;
}

async function getWaitlistOffer(prisma, tokenHash) {
  const entry = await prisma.waitlist.findUnique({ where: { claimToken: tokenHash }, include: waitlistInclude });
  if (!entry || !entry.patient.isActive || entry.status !== 'NOTIFIED' || !entry.offeredStartAt || !entry.offerExpiresAt) return null;
  return entry;
}

async function claimWaitlistOffer(prisma, { waitlistId, patientId, tokenHash }) {
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const entry = await tx.waitlist.findUnique({
        where: waitlistId ? { id: waitlistId } : { claimToken: tokenHash },
        include: waitlistInclude,
      });
      if (!entry) return { status: 404, error: 'This offer is invalid or has already expired.' };
      if (!entry.patient.isActive) return { status: 404, error: 'This offer is invalid or has already expired.' };
      if (patientId && entry.patientId !== patientId) return { status: 404, error: 'This offer is invalid or has already expired.' };
      if (entry.status === 'BOOKED') return { alreadyClaimed: true };
      if (entry.status !== 'NOTIFIED' || !entry.offeredStartAt || !entry.offerExpiresAt) {
        return { status: 409, error: 'This waitlist entry does not have an active offer.' };
      }
      if (entry.offerExpiresAt <= new Date()) {
        await tx.waitlist.updateMany({ where: { id: entry.id, status: 'NOTIFIED' }, data: { status: 'EXPIRED', claimToken: null } });
        return { expired: true, doctorId: entry.doctorId, startAt: entry.offeredStartAt };
      }

      const availability = await findAvailabilityForStart(tx, entry.doctorId, entry.offeredStartAt);
      const open = availability && await isSlotOpen(tx, entry.doctorId, entry.offeredStartAt, availability.slotMinutes, undefined, entry.id);
      if (!open) {
        await tx.waitlist.updateMany({ where: { id: entry.id, status: 'NOTIFIED' }, data: { status: 'EXPIRED', claimToken: null } });
        return { unavailable: true, doctorId: entry.doctorId, startAt: entry.offeredStartAt };
      }

      const actionToken = createActionToken();
      const changed = await tx.waitlist.updateMany({
        where: { id: entry.id, status: 'NOTIFIED', claimToken: entry.claimToken, offerExpiresAt: { gt: new Date() } },
        data: { status: 'BOOKED', claimToken: null },
      });
      if (!changed.count) return { status: 409, error: 'This offer was claimed or expired. Refresh to see its current status.' };
      const appointment = await tx.appointment.create({
        data: {
          patientId: entry.patientId,
          doctorId: entry.doctorId,
          startAt: entry.offeredStartAt,
          endAt: new Date(entry.offeredStartAt.getTime() + availability.slotMinutes * 60_000),
          status: 'PENDING',
          confirmationStatus: 'UNCONFIRMED',
          actionToken: actionToken.tokenHash,
          reason: null,
        },
        include: appointmentInclude,
      });
      await createBookingNotifications(tx, appointment, appointment.patient.notificationPreference);
      return { appointment, actionToken: actionToken.token };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2002' || error.code === 'P2034') {
      const entry = waitlistId
        ? await prisma.waitlist.findUnique({ where: { id: waitlistId }, select: { id: true, doctorId: true, offeredStartAt: true } })
        : await prisma.waitlist.findUnique({ where: { claimToken: tokenHash }, select: { id: true, doctorId: true, offeredStartAt: true } });
      if (entry?.offeredStartAt) {
        await prisma.waitlist.updateMany({ where: { id: entry.id, status: 'NOTIFIED' }, data: { status: 'EXPIRED', claimToken: null } });
        await offerNextWaitlist(prisma, entry.doctorId, entry.offeredStartAt);
      }
      return { status: 409, error: 'That time has just been taken. The next eligible patient will be offered the slot.' };
    }
    throw error;
  }

  if (result.expired || result.unavailable) {
    await offerNextWaitlist(prisma, result.doctorId, result.startAt);
    return { status: 410, error: result.expired ? 'This offer has expired.' : 'That appointment slot is no longer available.' };
  }
  if (result.status) return result;
  if (result.alreadyClaimed) return { alreadyClaimed: true };

  let emailSent = false;
  if (result.appointment.patient.notificationPreference?.emailEnabled ?? true) {
    try {
      await sendBookingConfirmation(result.appointment, result.actionToken);
      emailSent = true;
    } catch (error) {
      console.error(`Could not send waitlist booking confirmation for appointment ${result.appointment.id}: ${error.message}`);
    }
  }
  return { appointment: result.appointment, emailSent };
}

async function expireWaitlistOffer(prisma, entry) {
  const result = await prisma.waitlist.updateMany({
    where: { id: entry.id, status: 'NOTIFIED', offerExpiresAt: { lte: new Date() } },
    data: { status: 'EXPIRED', claimToken: null },
  });
  if (result.count && entry.offeredStartAt) await offerNextWaitlist(prisma, entry.doctorId, entry.offeredStartAt);
  return result.count > 0;
}

async function processExpiredWaitlistOffers(prisma) {
  const now = new Date();
  const entries = await prisma.waitlist.findMany({
    where: { status: 'NOTIFIED', offerExpiresAt: { lte: now } },
    select: { id: true, doctorId: true, offeredStartAt: true },
    orderBy: { offerExpiresAt: 'asc' },
    take: 100,
  });
  for (const entry of entries) {
    try {
      await expireWaitlistOffer(prisma, entry);
    } catch (error) {
      console.error(`Could not expire waitlist offer ${entry.id}: ${error.message}`);
    }
  }
}

module.exports = { offerNextWaitlist, getWaitlistOffer, claimWaitlistOffer, expireWaitlistOffer, processExpiredWaitlistOffers };
