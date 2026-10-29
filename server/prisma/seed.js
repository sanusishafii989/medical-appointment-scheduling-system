require('dotenv').config();

const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL },
  },
});
const DEMO_PASSWORD = 'Password123!';
const departments = ['Cardiology', 'Family Medicine', 'Pediatrics', 'Dermatology'];
const doctorSeed = [
  ['Amina Bello', 'amina.bello@example.test', 'Cardiology', 'Cardiologist'],
  ['David Okafor', 'david.okafor@example.test', 'Cardiology', 'Cardiologist'],
  ['Grace Adeyemi', 'grace.adeyemi@example.test', 'Family Medicine', 'Family Physician'],
  ['Emeka Nwosu', 'emeka.nwosu@example.test', 'Family Medicine', 'Family Physician'],
  ['Fatima Yusuf', 'fatima.yusuf@example.test', 'Pediatrics', 'Pediatrician'],
  ['Samuel Eze', 'samuel.eze@example.test', 'Dermatology', 'Dermatologist'],
];
const patientSeed = Array.from({ length: 10 }, (_, index) => [
  `Demo Patient ${index + 1}`,
  `patient${index + 1}@example.test`,
]);

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function randomWeekdayWithin(daysBack) {
  let date;
  do {
    date = new Date();
    date.setDate(date.getDate() - randomInt(daysBack));
  } while (date.getDay() === 0 || date.getDay() === 6);
  date.setHours(0, 0, 0, 0);
  return date;
}

function randomPastAppointmentStatus(confirmed) {
  const roll = Math.random();
  if (confirmed) {
    if (roll < 0.05) return 'NO_SHOW';
    if (roll < 0.23) return 'CANCELLED';
    return 'COMPLETED';
  }
  if (roll < 0.25) return 'NO_SHOW';
  if (roll < 0.42) return 'CANCELLED';
  return 'COMPLETED';
}

async function upsertUser({ name, email, role, phone }) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  return prisma.user.upsert({
    where: { email },
    update: { name, role, phone, passwordHash },
    create: { name, email, role, phone, passwordHash },
  });
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const departmentRows = {};
  for (const name of departments) {
    departmentRows[name] = await prisma.department.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  await upsertUser({ name: 'System Administrator', email: 'admin@example.test', role: 'ADMIN' });

  const doctors = [];
  for (const [name, email, departmentName, specialization] of doctorSeed) {
    const user = await upsertUser({ name, email, role: 'DOCTOR' });
    const profile = await prisma.doctorProfile.upsert({
      where: { userId: user.id },
      update: { departmentId: departmentRows[departmentName].id, specialization },
      create: { userId: user.id, departmentId: departmentRows[departmentName].id, specialization },
    });
    doctors.push(profile);
    for (let dayOfWeek = 1; dayOfWeek <= 5; dayOfWeek += 1) {
      await prisma.availability.upsert({
        where: { doctorId_dayOfWeek: { doctorId: profile.id, dayOfWeek } },
        update: { startTime: '09:00', endTime: '16:00', slotMinutes: 30 },
        create: { doctorId: profile.id, dayOfWeek, startTime: '09:00', endTime: '16:00', slotMinutes: 30 },
      });
    }
  }

  const patients = [];
  for (const [name, email] of patientSeed) {
    const user = await upsertUser({ name, email, role: 'PATIENT' });
    patients.push(user);
    await prisma.notificationPreference.upsert({
      where: { userId: user.id },
      update: { emailEnabled: true, inAppEnabled: true },
      create: { userId: user.id, emailEnabled: true, inAppEnabled: true },
    });
  }

  // Replace only historical appointments owned by the dedicated demo patients.
  // Run this seed against a development database, never a production database.
  const patientIds = patients.map((patient) => patient.id);
  const oldAppointments = await prisma.appointment.findMany({
    where: { patientId: { in: patientIds } },
    select: { id: true },
  });
  const oldAppointmentIds = oldAppointments.map(({ id }) => id);
  await prisma.reminder.deleteMany({ where: { appointmentId: { in: oldAppointmentIds } } });
  await prisma.notification.deleteMany({ where: { appointmentId: { in: oldAppointmentIds } } });
  await prisma.appointment.deleteMany({ where: { id: { in: oldAppointmentIds } } });

  const occupied = new Set();
  const appointments = [];
  while (appointments.length < 150) {
    const doctor = doctors[randomInt(doctors.length)];
    const patient = patients[randomInt(patients.length)];
    const day = randomWeekdayWithin(60);
    const minutesAfterOpening = randomInt(14) * 30;
    const startAt = new Date(day);
    startAt.setHours(9 + Math.floor(minutesAfterOpening / 60), minutesAfterOpening % 60, 0, 0);
    const key = `${doctor.id}:${startAt.toISOString()}`;
    if (occupied.has(key)) continue;
    occupied.add(key);

    const confirmed = Math.random() < 0.7;
    const status = randomPastAppointmentStatus(confirmed);
    const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
    const createdAt = new Date(startAt.getTime() - (2 + randomInt(13)) * 24 * 60 * 60 * 1000);
    appointments.push({
      patientId: patient.id,
      doctorId: doctor.id,
      startAt,
      endAt,
      status,
      confirmationStatus: confirmed ? 'CONFIRMED_BY_PATIENT' : 'UNCONFIRMED',
      confirmedAt: confirmed ? new Date(createdAt.getTime() + 60 * 60 * 1000) : null,
      actionToken: randomBytes(32).toString('hex'),
      reason: ['Routine check-up', 'Follow-up visit', 'Consultation'][randomInt(3)],
      createdAt,
    });
  }

  await prisma.appointment.createMany({ data: appointments });
  console.log(`Seeded 1 admin, ${doctors.length} doctors, ${patients.length} patients and ${appointments.length} historical appointments.`);
  console.log(`Demo password: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
