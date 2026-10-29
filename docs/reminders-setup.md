# Email and reminder setup

The app always creates in-app appointment notifications. Email confirmations, calendar attachments, appointment action links, and email reminders are sent only when SMTP is configured.

Set these values in the ignored local file `server/.env`:

```dotenv
SMTP_HOST=your-provider-smtp-host
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password-or-app-password
EMAIL_FROM=CareSlot <verified-sender@example.com>
CLIENT_URL=http://localhost:5173
```

Use the SMTP host, port, credentials, and verified sender supplied by your email provider. Keep credentials private and do not commit `.env`.

The API attempts a booking confirmation email after the appointment is committed. If sending fails, the booking remains successful and the response reports `emailSent: false`; the server logs a delivery error. Scheduled email reminders are recorded as failed and retried after a short delay, with at most three total attempts. In-app confirmations and reminders remain available even when email is not configured.

Appointment emails contain only the doctor, date, and time. They do not include the appointment reason. The calendar attachment also omits medical details. Email action tokens are cryptographically random, stored as SHA-256 hashes, and placed in the page URL fragment so link scanners cannot trigger a confirmation or cancellation. The action page requires the patient to press a button, and the API changes state only on an explicit POST request.
