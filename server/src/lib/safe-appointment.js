function safeAppointment(appointment) {
  return {
    id: appointment.id,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: appointment.status,
    confirmationStatus: appointment.confirmationStatus,
    reason: appointment.reason,
    doctor: appointment.doctor && {
      id: appointment.doctor.id,
      specialization: appointment.doctor.specialization,
      department: appointment.doctor.department,
      user: { name: appointment.doctor.user.name },
    },
    patient: appointment.patient && { id: appointment.patient.id, name: appointment.patient.name },
  };
}

module.exports = safeAppointment;
