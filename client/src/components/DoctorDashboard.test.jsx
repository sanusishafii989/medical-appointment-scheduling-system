import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DoctorDashboard from './DoctorDashboard.jsx';

const doctorUser = { id: 'doctor-user-1', name: 'Dr. Amina Bello' };
const appointment = {
  id: 'appointment-1',
  patient: { name: 'Patient Name' },
  startAt: '2026-10-30T09:00:00.000Z',
  endAt: '2026-10-30T09:30:00.000Z',
  reason: 'Follow-up',
  status: 'CONFIRMED',
};

let apiRequest;

beforeEach(() => {
  apiRequest = vi.fn(async (path, options = {}) => {
    if (path.startsWith('/appointments?')) return { appointments: [appointment] };
    if (path === '/doctors/me/availability' && !options.method) {
      return { availability: [{ dayOfWeek: 1, startTime: '09:00', endTime: '16:00', slotMinutes: 30 }] };
    }
    if (path === '/notifications') return { notifications: [] };
    if (path === '/doctors/me/availability' && options.method === 'PUT') return { availability: JSON.parse(options.body).availability };
    if (path === '/appointments/appointment-1/outcome' && options.method === 'PATCH') {
      const status = JSON.parse(options.body).status;
      return { appointment: { ...appointment, status } };
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDoctorDashboard() {
  return render(<DoctorDashboard user={doctorUser} onSignOut={vi.fn()} apiRequest={apiRequest} />);
}

describe('doctor dashboard workflows', () => {
  it('saves weekly availability updates', async () => {
    const user = userEvent.setup();
    renderDoctorDashboard();

    await screen.findByText('Reason: Follow-up');
    await user.click(await screen.findByLabelText('Thursday'));
    await user.selectOptions(screen.getByLabelText('Thursday slot length'), '45');
    await user.click(screen.getByRole('button', { name: 'Save availability' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/doctors/me/availability', expect.objectContaining({ method: 'PUT' })));
    const [, options] = apiRequest.mock.calls.find(([path, request]) => path === '/doctors/me/availability' && request?.method === 'PUT');
    expect(JSON.parse(options.body).availability).toEqual([
      { dayOfWeek: 1, startTime: '09:00', endTime: '16:00', slotMinutes: 30 },
      { dayOfWeek: 4, startTime: '09:00', endTime: '16:00', slotMinutes: 45 },
    ]);
    expect(await screen.findByText('Your weekly availability has been saved.')).toBeTruthy();
  });

  it('records an appointment outcome and updates the displayed status', async () => {
    const user = userEvent.setup();
    renderDoctorDashboard();

    await user.click(await screen.findByRole('button', { name: 'Completed' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/appointments/appointment-1/outcome', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'COMPLETED' }),
    })));
    expect(await screen.findByText('Visit recorded as completed.')).toBeTruthy();
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'No-show' })).toBeNull();
  });
});
