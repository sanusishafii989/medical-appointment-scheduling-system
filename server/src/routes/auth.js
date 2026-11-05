const { Router } = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/authenticate');
const { replaceAppointmentReminders } = require('../services/appointment-notifications');

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.' },
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(72),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(72),
});

const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(30).optional(),
  notificationPreference: z.object({
    emailEnabled: z.boolean().optional(),
    inAppEnabled: z.boolean().optional(),
  }).strict().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one profile or notification setting to update.',
});

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
}

function createToken(user) {
  return jwt.sign({ role: user.role }, process.env.JWT_SECRET, {
    subject: user.id,
    expiresIn: '1d',
  });
}

router.post('/register', authLimiter, async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Check the registration details and try again.', errors: parsed.error.issues });
  }

  const { name, email, password, phone } = parsed.data;
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        phone: phone || null,
        role: 'PATIENT',
        notificationPreference: { create: { emailEnabled: true, inAppEnabled: true } },
      },
    });
    return res.status(201).json({ success: true, token: createToken(user), user: publicUser(user) });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'An account with that email already exists.' });
    }
    return next(error);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Enter a valid email and password.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    const passwordMatches = user && user.isActive && await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ success: false, message: 'Email or password is incorrect.' });
    }
    return res.status(200).json({ success: true, token: createToken(user), user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        notificationPreference: { select: { emailEnabled: true, inAppEnabled: true } },
      },
    });
    if (!user) return res.status(401).json({ success: false, message: 'Account not found.' });
    return res.json({ success: true, user });
  } catch (error) {
    return next(error);
  }
});

router.patch('/me', authenticate, requireRole('PATIENT'), async (req, res, next) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Check the profile details and try again.', errors: parsed.error.issues });
  }

  const { name, phone, notificationPreference } = parsed.data;
  try {
    const user = await prisma.$transaction(async (tx) => {
      const profile = name !== undefined || phone !== undefined
        ? await tx.user.update({
          where: { id: req.auth.userId },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(phone !== undefined ? { phone: phone || null } : {}),
          },
          select: { id: true, name: true, email: true, phone: true, role: true },
        })
        : await tx.user.findUnique({
          where: { id: req.auth.userId },
          select: { id: true, name: true, email: true, phone: true, role: true },
        });

      if (!profile) return null;

      if (notificationPreference) {
        await tx.notificationPreference.upsert({
          where: { userId: req.auth.userId },
          create: {
            userId: req.auth.userId,
            emailEnabled: notificationPreference.emailEnabled ?? true,
            inAppEnabled: notificationPreference.inAppEnabled ?? true,
          },
          update: notificationPreference,
        });
      }

      const preferences = await tx.notificationPreference.findUnique({
        where: { userId: req.auth.userId },
        select: { emailEnabled: true, inAppEnabled: true },
      }) || { emailEnabled: true, inAppEnabled: true };

      if (notificationPreference) {
        const upcomingAppointments = await tx.appointment.findMany({
          where: {
            patientId: req.auth.userId,
            status: { in: ['PENDING', 'CONFIRMED'] },
            startAt: { gt: new Date() },
          },
          select: { id: true, startAt: true },
        });
        for (const appointment of upcomingAppointments) {
          await replaceAppointmentReminders(tx, appointment, preferences);
        }
      }

      return {
        ...profile,
        notificationPreference: preferences,
      };
    });

    if (!user) return res.status(401).json({ success: false, message: 'Account not found.' });
    return res.json({ success: true, user });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
