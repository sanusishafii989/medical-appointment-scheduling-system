const safeAppointment = require('./safe-appointment');

describe('safeAppointment', () => {
  test('returns appointment details without private account fields', () => {
    const appointment = {
      id: 'appointment-1',
      startAt: new Date('2026-11-02T08:00:00.000Z'),
      endAt: new Date('2026-11-02T08:30:00.000Z'),
      status: 'CONFIRMED',
      confirmationStatus: 'CONFIRMED_BY_PATIENT',
      reason: 'Follow-up',
      doctor: {
        id: 'doctor-1',
        specialization: 'Dermatologist',
        department: 'Dermatology',
        user: { name: 'Dr. Salma A.A', email: 'doctor@example.test', passwordHash: 'secret-hash' },
      },
      patient: { id: 'patient-1', name: 'Patient', email: 'patient@example.test', passwordHash: 'secret-hash' },
    };

    expect(safeAppointment(appointment)).toEqual({
      id: 'appointment-1',
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      status: 'CONFIRMED',
      confirmationStatus: 'CONFIRMED_BY_PATIENT',
      reason: 'Follow-up',
      doctor: {
        id: 'doctor-1',
        specialization: 'Dermatologist',
        department: 'Dermatology',
        user: { name: 'Dr. Salma A.A' },
      },
      patient: { id: 'patient-1', name: 'Patient' },
    });
  });
});
