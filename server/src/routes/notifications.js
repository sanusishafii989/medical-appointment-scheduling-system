const { Router } = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/authenticate');

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  try {
    const [notifications, total, unread] = await prisma.$transaction([
      prisma.notification.findMany({
        where: { userId: req.auth.userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 20,
        take: 20,
        select: { id: true, title: true, message: true, read: true, createdAt: true, appointmentId: true },
      }),
      prisma.notification.count({ where: { userId: req.auth.userId } }),
      prisma.notification.count({ where: { userId: req.auth.userId, read: false } }),
    ]);
    return res.json({ success: true, notifications, unread, pagination: { page, pageSize: 20, total } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/read-all', async (req, res, next) => {
  try {
    const result = await prisma.notification.updateMany({ where: { userId: req.auth.userId, read: false }, data: { read: true } });
    return res.json({ success: true, updated: result.count });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:notificationId/read', async (req, res, next) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { id: req.params.notificationId, userId: req.auth.userId },
      data: { read: true },
    });
    if (!result.count) return res.status(404).json({ success: false, message: 'Notification not found.' });
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
