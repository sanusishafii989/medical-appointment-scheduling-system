import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from './AdminDashboard.jsx';

const admin = { id: 'admin-1', name: 'Admin User' };
const department = {
  id: 'department-1',
  name: 'Cardiology',
  _count: { doctors: 1 },
  doctors: [{
    id: 'doctor-1',
    specialization: 'Cardiologist',
    user: { name: 'Dr. Amina Bello', isActive: true },
  }],
};
const appointment = {
  id: 'appointment-1',
  patient: { name: 'Patient Name' },
  doctor: {
    user: { name: 'Dr. Amina Bello' },
    specialization: 'Cardiologist',
    department: { name: 'Cardiology' },
  },
  startAt: '2026-11-05T08:30:00.000Z',
  status: 'CONFIRMED',
};

let apiRequest;
let accountActive;

beforeEach(() => {
  accountActive = true;
  apiRequest = vi.fn(async (path, options = {}) => {
    if (path === '/admin/departments') return { departments: [department] };
    if (path.startsWith('/admin/users?')) {
      return {
        users: accountActive ? [{
          id: 'patient-1',
          name: 'Patient Name',
          email: 'patient@example.test',
          role: 'PATIENT',
          isActive: true,
        }] : [],
        pagination: { page: 1, pageSize: 20, total: accountActive ? 1 : 0 },
      };
    }
    if (path === '/admin/users/patient-1/status' && options.method === 'PATCH') {
      accountActive = JSON.parse(options.body).isActive;
      return {};
    }
    if (path.startsWith('/appointments?')) {
      const params = new URLSearchParams(path.split('?')[1]);
      return {
        appointments: !params.get('status') || params.get('status') === appointment.status ? [appointment] : [],
        pagination: { page: 1, pageSize: 20, total: !params.get('status') || params.get('status') === appointment.status ? 1 : 0 },
      };
    }
    if (path.startsWith('/analytics/summary?')) {
      return {
        period: { from: '2026-10-04', to: '2026-11-02' },
        summary: { total: 1, cancelled: 0, cancellationRate: 0, completed: 0, noShow: 0, noShowRate: null, outcomeCount: 0 },
        waitlist: { fillRate: null, claimed: 0, resolved: 0, active: 0 },
        confirmationBreakdown: [],
      };
    }
    if (path.startsWith('/analytics/patterns?')) {
      return { patterns: { weekdays: [], hours: [], doctors: [], departments: [] } };
    }
    if (path.startsWith('/reminders?')) return { reminders: [], pagination: { page: 1, pageSize: 25, total: 0 } };
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAdminDashboard() {
  return render(<AdminDashboard user={admin} onSignOut={vi.fn()} apiRequest={apiRequest} apiUrl="/api" />);
}

describe('admin dashboard workflows', () => {
  it('filters appointments by status', async () => {
    const user = userEvent.setup();
    renderAdminDashboard();

    expect(await screen.findByText('Patient Name with Dr. Amina Bello')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Status'), 'CANCELLED');

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/appointments?page=1&status=CANCELLED');
    });
    expect(await screen.findByText('No appointments match these filters.')).toBeTruthy();
  });

  it('requires confirmation before deactivating an account', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderAdminDashboard();

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));

    expect(window.confirm).toHaveBeenCalledWith("Deactivate Patient Name's account? They will no longer be able to sign in.");
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/admin/users/patient-1/status', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ isActive: false }),
      }));
    });
    expect(await screen.findByText("Patient Name's account is now inactive.")).toBeTruthy();
  });
});
