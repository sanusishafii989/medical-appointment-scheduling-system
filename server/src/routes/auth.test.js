jest.mock('../lib/prisma', () => ({
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  notificationPreference: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
  appointment: {
    findMany: jest.fn(),
  },
  reminder: {
    updateMany: jest.fn(),
    upsert: jest.fn(),
  },
  $transaction: jest.fn(),
}));

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../lib/prisma');
const authRoutes = require('./auth');

const userId = 'patient-1';
const profile = {
  id: userId,
  name: 'Patient Name',
  email: 'patient@example.test',
  phone: null,
  role: 'PATIENT',
};

const transactionClient = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  notificationPreference: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
  appointment: {
    findMany: jest.fn(),
  },
  reminder: {
    updateMany: jest.fn(),
    upsert: jest.fn(),
  },
};

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));

function bearerToken(role = 'PATIENT') {
  return jwt.sign({ role }, process.env.JWT_SECRET, { subject: userId });
}

describe('patient account settings', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-for-auth-routes';
    jest.clearAllMocks();
    prisma.user.findUnique.mockImplementation(({ select }) => (
      select?.isActive ? { isActive: true } : profile
    ));
    prisma.$transaction.mockImplementation((callback) => callback(transactionClient));
    transactionClient.user.findUnique.mockResolvedValue(profile);
    transactionClient.user.update.mockResolvedValue(profile);
    transactionClient.notificationPreference.upsert.mockResolvedValue({});
    transactionClient.notificationPreference.findUnique.mockResolvedValue({ emailEnabled: true, inAppEnabled: true });
    transactionClient.appointment.findMany.mockResolvedValue([]);
    transactionClient.reminder.updateMany.mockResolvedValue({ count: 0 });
    transactionClient.reminder.upsert.mockResolvedValue({});
  });

  test('rejects profile updates from non-patient accounts', async () => {
    const response = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${bearerToken('DOCTOR')}`)
      .send({ name: 'New Name' });

    expect(response.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects empty or invalid profile updates', async () => {
    const response = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${bearerToken()}`)
      .send({ name: 'x' });

    expect(response.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('saves profile and notification preferences and reschedules future reminders', async () => {
    const updatedProfile = { ...profile, name: 'Updated Patient', phone: '08012345678' };
    transactionClient.user.update.mockResolvedValue(updatedProfile);
    transactionClient.notificationPreference.findUnique.mockResolvedValue({ emailEnabled: false, inAppEnabled: true });
    transactionClient.appointment.findMany.mockResolvedValue([{
      id: 'appointment-1',
      startAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    }]);

    const response = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${bearerToken()}`)
      .send({
        name: '  Updated Patient  ',
        phone: '08012345678',
        notificationPreference: { emailEnabled: false, inAppEnabled: true },
      });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      name: 'Updated Patient',
      phone: '08012345678',
      notificationPreference: { emailEnabled: false, inAppEnabled: true },
    });
    expect(transactionClient.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId },
      update: { emailEnabled: false, inAppEnabled: true },
    }));
    expect(transactionClient.reminder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { appointmentId: 'appointment-1', status: { in: ['PENDING', 'FAILED'] } },
    }));
    expect(transactionClient.reminder.upsert).toHaveBeenCalledTimes(2);
    for (const [call] of transactionClient.reminder.upsert.mock.calls) {
      expect(call.create.type).toBe('IN_APP');
    }
  });

  test('allows reading the signed-in profile and notification preferences', async () => {
    const account = { ...profile, notificationPreference: { emailEnabled: false, inAppEnabled: true } };
    prisma.user.findUnique.mockImplementation(({ select }) => (
      select?.isActive ? { isActive: true } : account
    ));

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${bearerToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.user.notificationPreference).toEqual({ emailEnabled: false, inAppEnabled: true });
  });
});
