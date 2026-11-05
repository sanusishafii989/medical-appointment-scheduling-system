import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';

const departments = [
  { id: 'department-cardiology', name: 'Cardiology' },
  { id: 'department-neurology', name: 'Neurology' },
];

const doctors = [
  {
    id: 'doctor-amina',
    specialization: 'Cardiologist',
    bio: 'Heart care',
    department: departments[0],
    user: { name: 'Dr. Amina Bello' },
  },
  {
    id: 'doctor-yemi',
    specialization: 'Neurologist',
    bio: 'Neurology care',
    department: departments[1],
    user: { name: 'Dr. Yemi Okafor' },
  },
];

const patient = {
  id: 'patient-1',
  name: 'Test Patient',
  email: 'patient@example.test',
  phone: '08000000000',
  role: 'PATIENT',
  notificationPreference: { emailEnabled: true, inAppEnabled: true },
};

const openSlot = { startAt: '2026-11-05T08:30:00.000Z', time: '9:30 AM' };
let slotsForDoctor = [openSlot];
let appointmentsForPatient = [];

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function getRequest(url, method = 'GET') {
  return globalThis.fetch.mock.calls.find(([input, init]) => {
    const requestUrl = new URL(input);
    return requestUrl.pathname === url && (init?.method || 'GET') === method;
  });
}

function getDoctorRequests() {
  return globalThis.fetch.mock.calls.filter(([input]) => new URL(input).pathname === '/api/doctors');
}

function renderPatientApp() {
  return render(<MemoryRouter initialEntries={['/access']}><App /></MemoryRouter>);
}

function upcomingAppointment() {
  const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return {
    id: 'appointment-1',
    doctor: doctors[0],
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + 30 * 60 * 1000).toISOString(),
    status: 'CONFIRMED',
  };
}

async function signIn(user) {
  await user.type(screen.getByLabelText('Email address'), patient.email);
  await user.type(screen.getByLabelText('Password'), 'patient-password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('heading', { name: 'Book an appointment' })).toBeTruthy();
}

beforeEach(() => {
  sessionStorage.clear();
  slotsForDoctor = [openSlot];
  appointmentsForPatient = [];
  HTMLElement.prototype.scrollIntoView = vi.fn();
  globalThis.fetch = vi.fn(async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || 'GET';

    if (url.pathname === '/api/auth/login' && method === 'POST') {
      sessionStorage.setItem('care-slot-token', 'test-token');
      return jsonResponse({ token: 'test-token', user: patient });
    }
    if (url.pathname === '/api/auth/me' && method === 'GET') {
      return jsonResponse({ user: patient });
    }
    if (url.pathname === '/api/auth/me' && method === 'PATCH') {
      return jsonResponse({
        user: {
          ...patient,
          name: 'Updated Patient',
          phone: '08123456789',
          notificationPreference: { emailEnabled: false, inAppEnabled: true },
        },
      });
    }
    if (url.pathname === '/api/doctors/departments') {
      return jsonResponse({ departments });
    }
    if (url.pathname === '/api/doctors') {
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const departmentId = url.searchParams.get('departmentId');
      return jsonResponse({
        doctors: doctors.filter((doctor) => (
          doctor.user.name.toLowerCase().includes(search)
          && (!departmentId || doctor.department.id === departmentId)
        )),
      });
    }
    if (url.pathname.startsWith('/api/doctors/') && url.pathname.endsWith('/slots')) {
      return jsonResponse({ slots: slotsForDoctor });
    }
    if (url.pathname === '/api/appointments' && method === 'GET') {
      return jsonResponse({ appointments: appointmentsForPatient });
    }
    if (url.pathname === '/api/appointments' && method === 'POST') {
      return jsonResponse({ emailSent: false }, 201);
    }
    if (/^\/api\/appointments\/[^/]+\/(cancel|reschedule)$/.test(url.pathname) && method === 'PATCH') {
      return jsonResponse({ emailSent: false });
    }
    if (url.pathname === '/api/notifications') {
      return jsonResponse({ notifications: [] });
    }
    if (url.pathname === '/api/waitlist' && method === 'GET') {
      return jsonResponse({ waitlist: [] });
    }
    if (url.pathname === '/api/waitlist' && method === 'POST') {
      return jsonResponse({ message: 'You joined the waitlist.' }, 201);
    }
    return jsonResponse({ message: `Unexpected request: ${method} ${url.pathname}` }, 404);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('patient dashboard workflows', () => {
  it('searches doctors by name and applies the department filter', async () => {
    const user = userEvent.setup();
    renderPatientApp();
    await signIn(user);

    const doctorSelect = await screen.findByLabelText('Doctor');
    await screen.findByRole('option', { name: 'Dr. Amina Bello · Cardiologist' });

    await user.type(screen.getByLabelText('Find a doctor'), 'Yemi');
    await waitFor(() => {
      const request = getDoctorRequests().find(([input]) => new URL(input).searchParams.get('search') === 'Yemi');
      expect(request).toBeTruthy();
    });
    expect(await screen.findByRole('option', { name: 'Dr. Yemi Okafor · Neurologist' })).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Department'), 'department-cardiology');
    await waitFor(() => {
      const requests = getDoctorRequests();
      expect(new URL(requests.at(-1)[0]).searchParams.get('departmentId')).toBe('department-cardiology');
    });
    expect(within(doctorSelect).queryByRole('option', { name: 'Dr. Yemi Okafor · Neurologist' })).toBeNull();
    expect(screen.getByText('No doctors match your search. Try another name or department.')).toBeTruthy();
  });

  it('books an available doctor slot', async () => {
    const user = userEvent.setup();
    renderPatientApp();
    await signIn(user);

    await user.type(screen.getByLabelText('Find a doctor'), 'Amina');
    const bookingButton = await screen.findByRole('button', { name: openSlot.time });
    await user.type(screen.getByLabelText(/Reason/), 'Annual check-up');
    await user.click(bookingButton);

    await waitFor(() => expect(getRequest('/api/appointments', 'POST')).toBeTruthy());
    const bookingRequest = getRequest('/api/appointments', 'POST');
    expect(JSON.parse(bookingRequest[1].body)).toMatchObject({
      doctorId: 'doctor-amina',
      startAt: openSlot.startAt,
      reason: 'Annual check-up',
    });
    expect(await screen.findByText(/Appointment booked/)).toBeTruthy();
  });

  it('reschedules an upcoming appointment to a new slot', async () => {
    appointmentsForPatient = [upcomingAppointment()];
    const user = userEvent.setup();
    renderPatientApp();
    await signIn(user);

    await user.click(await screen.findByRole('button', { name: 'Reschedule' }));
    expect(await screen.findByRole('heading', { name: 'Choose a new appointment time' })).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: openSlot.time }));

    await waitFor(() => {
      const request = getRequest('/api/appointments/appointment-1/reschedule', 'PATCH');
      expect(request).toBeTruthy();
      expect(JSON.parse(request[1].body)).toEqual({ startAt: openSlot.startAt });
    });
    expect(await screen.findByText(/Appointment rescheduled/)).toBeTruthy();
  });

  it('asks for confirmation before cancelling an upcoming appointment', async () => {
    appointmentsForPatient = [upcomingAppointment()];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderPatientApp();
    await signIn(user);

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(window.confirm).toHaveBeenCalledWith('Cancel this appointment?');
    await waitFor(() => expect(getRequest('/api/appointments/appointment-1/cancel', 'PATCH')).toBeTruthy());
    expect(await screen.findByText('Appointment cancelled.')).toBeTruthy();
  });

  it('joins the waitlist when the selected doctor has no available slots', async () => {
    slotsForDoctor = [];
    const user = userEvent.setup();
    renderPatientApp();
    await signIn(user);

    await user.type(screen.getByLabelText('Find a doctor'), 'Amina');
    const waitlistButton = await screen.findByRole('button', { name: 'Join this date’s waitlist' });
    await user.click(waitlistButton);

    await waitFor(() => expect(getRequest('/api/waitlist', 'POST')).toBeTruthy());
    const waitlistRequest = getRequest('/api/waitlist', 'POST');
    expect(JSON.parse(waitlistRequest[1].body)).toMatchObject({ doctorId: 'doctor-amina' });
    expect(await screen.findByText('You joined the waitlist.')).toBeTruthy();
  });

  it('saves profile and appointment reminder preferences', async () => {
    const user = userEvent.setup();
    renderPatientApp();
    await signIn(user);

    await user.clear(screen.getByLabelText('Full name'));
    await user.type(screen.getByLabelText('Full name'), 'Updated Patient');
    await user.clear(screen.getByLabelText('Phone number Optional'));
    await user.type(screen.getByLabelText('Phone number Optional'), '08123456789');
    await user.click(screen.getByRole('checkbox', { name: /Email confirmations and reminders/ }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(getRequest('/api/auth/me', 'PATCH')).toBeTruthy());
    const saveRequest = getRequest('/api/auth/me', 'PATCH');
    expect(JSON.parse(saveRequest[1].body)).toMatchObject({
      name: 'Updated Patient',
      phone: '08123456789',
      notificationPreference: { emailEnabled: false, inAppEnabled: true },
    });
    expect(await screen.findByText('Your profile and notification preferences have been saved.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Hello, Updated Patient' })).toBeTruthy();
  });
});
