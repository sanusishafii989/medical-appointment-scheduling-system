const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { hashActionToken } = require('../lib/action-tokens');
const { getWaitlistOffer, claimWaitlistOffer } = require('../services/waitlist');
const safeAppointment = require('../lib/safe-appointment');

const router = Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.' },
});
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const bodySchema = z.object({ token: tokenSchema });

function summary(entry) {
  return {
    offer: {
      id: entry.id,
      doctor: entry.doctor.user.name,
      specialization: entry.doctor.specialization,
      department: entry.doctor.department.name,
      startAt: entry.offeredStartAt,
      expiresAt: entry.offerExpiresAt,
    },
    canClaim: entry.offerExpiresAt > new Date(),
  };
}

router.post('/preview', limiter, async (req, res, next) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'This offer link is invalid.' });
  try {
    const entry = await getWaitlistOffer(prisma, hashActionToken(parsed.data.token));
    if (!entry) return res.status(404).json({ success: false, message: 'This offer link is invalid or expired.' });
    if (entry.offerExpiresAt <= new Date()) return res.status(410).json({ success: false, message: 'This offer has expired.' });
    return res.json({ success: true, ...summary(entry) });
  } catch (error) {
    return next(error);
  }
});

router.post('/claim', limiter, async (req, res, next) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'This offer link is invalid.' });
  try {
    const result = await claimWaitlistOffer(prisma, { tokenHash: hashActionToken(parsed.data.token) });
    if (result.error) return res.status(result.status || 409).json({ success: false, message: result.error });
    return res.json({ success: true, message: result.alreadyClaimed ? 'This offer has already been claimed.' : 'Waitlist appointment claimed.', appointment: result.appointment ? safeAppointment(result.appointment) : undefined, emailSent: result.emailSent });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
