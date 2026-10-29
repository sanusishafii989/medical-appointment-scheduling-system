const { Router } = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/authenticate');

const router = Router();
const ROLES = ['PATIENT', 'DOCTOR', 'ADMIN'];
const PAGE_SIZE = 20;

const doctorSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  password: z.string().min(8).max(72),
  departmentId: z.string().min(1),
  specialization: z.string().trim().min(2).max(120),
  bio: z.string().trim().max(500).optional().or(z.literal('')),
});
const departmentSchema = z.object({ name: z.string().trim().min(2).max(100) });
const statusSchema = z.object({ isActive: z.boolean() });
const assignmentSchema = z.object({ departmentId: z.string().min(1), specialization: z.string().trim().min(2).max(120).optional() });

router.use(authenticate, requireRole('ADMIN'));

router.get('/users', async (req, res, next) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  if (req.query.role && !ROLES.includes(req.query.role)) return res.status(400).json({ success: false, message: 'Choose a valid account role.' });
  if (req.query.active !== undefined && !['true', 'false'].includes(req.query.active)) return res.status(400).json({ success: false, message: 'Choose active or inactive accounts.' });
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const where = {
    ...(req.query.role ? { role: req.query.role } : {}),
    ...(req.query.active !== undefined ? { isActive: req.query.active === 'true' } : {}),
    ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {}),
  };
  try {
    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true,
          doctorProfile: { select: { id: true, specialization: true, department: { select: { id: true, name: true } } } },
        },
        orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.user.count({ where }),
    ]);
    return res.json({ success: true, users, pagination: { page, pageSize: PAGE_SIZE, total } });
  } catch (error) { return next(error); }
});

router.patch('/users/:userId/status', async (req, res, next) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Choose whether this account should be active.' });
  if (req.params.userId === req.auth.userId && !parsed.data.isActive) return res.status(400).json({ success: false, message: 'You cannot deactivate your own administrator account.' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: req.params.userId }, select: { id: true, role: true, isActive: true } });
      if (!target) return { error: 'Account not found.', status: 404 };
      if (target.role === 'ADMIN' && target.isActive && !parsed.data.isActive) {
        const activeAdmins = await tx.user.count({ where: { role: 'ADMIN', isActive: true } });
        if (activeAdmins <= 1) return { error: 'The last active administrator cannot be deactivated.', status: 409 };
      }
      const user = await tx.user.update({
        where: { id: target.id },
        data: { isActive: parsed.data.isActive },
        select: { id: true, name: true, email: true, role: true, isActive: true },
      });
      return { user };
    }, { isolationLevel: 'Serializable' });
    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    return res.json({ success: true, user: result.user });
  } catch (error) {
    if (error.code === 'P2034') return res.status(409).json({ success: false, message: 'Another account change occurred. Refresh and try again.' });
    return next(error);
  }
});

router.post('/doctors', async (req, res, next) => {
  const parsed = doctorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Check the doctor account details and try again.', errors: parsed.error.issues });
  try {
    const department = await prisma.department.findUnique({ where: { id: parsed.data.departmentId }, select: { id: true } });
    if (!department) return res.status(400).json({ success: false, message: 'Choose an existing department.' });
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone || null,
        passwordHash,
        role: 'DOCTOR',
        notificationPreference: { create: { emailEnabled: true, inAppEnabled: true } },
        doctorProfile: { create: { departmentId: department.id, specialization: parsed.data.specialization, bio: parsed.data.bio || null } },
      },
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, doctorProfile: { select: { id: true, specialization: true, department: { select: { id: true, name: true } } } } },
    });
    return res.status(201).json({ success: true, user });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ success: false, message: 'An account with that email already exists.' });
    return next(error);
  }
});

router.get('/departments', async (_req, res, next) => {
  try {
    const departments = await prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { doctors: true } },
        doctors: { orderBy: { user: { name: 'asc' } }, select: { id: true, specialization: true, user: { select: { id: true, name: true, isActive: true } } } },
      },
    });
    return res.json({ success: true, departments });
  } catch (error) { return next(error); }
});

router.post('/departments', async (req, res, next) => {
  const parsed = departmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Department names must be 2 to 100 characters.' });
  try {
    const department = await prisma.department.create({ data: { name: parsed.data.name } });
    return res.status(201).json({ success: true, department });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ success: false, message: 'A department with that name already exists.' });
    return next(error);
  }
});

router.patch('/departments/:departmentId', async (req, res, next) => {
  const parsed = departmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Department names must be 2 to 100 characters.' });
  try {
    const department = await prisma.department.update({ where: { id: req.params.departmentId }, data: { name: parsed.data.name } });
    return res.json({ success: true, department });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ success: false, message: 'A department with that name already exists.' });
    if (error.code === 'P2025') return res.status(404).json({ success: false, message: 'Department not found.' });
    return next(error);
  }
});

router.patch('/doctors/:doctorId/assignment', async (req, res, next) => {
  const parsed = assignmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Choose a department and provide a valid specialization.' });
  try {
    const department = await prisma.department.findUnique({ where: { id: parsed.data.departmentId }, select: { id: true } });
    if (!department) return res.status(400).json({ success: false, message: 'Choose an existing department.' });
    const doctor = await prisma.doctorProfile.update({
      where: { id: req.params.doctorId },
      data: { departmentId: department.id, ...(parsed.data.specialization ? { specialization: parsed.data.specialization } : {}) },
      select: { id: true, specialization: true, department: { select: { id: true, name: true } }, user: { select: { name: true, isActive: true } } },
    });
    return res.json({ success: true, doctor });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    return next(error);
  }
});

module.exports = router;
