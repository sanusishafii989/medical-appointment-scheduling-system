# Database Entity Relationship Diagram

```mermaid
erDiagram
  USER ||--o| DOCTOR_PROFILE : has
  DEPARTMENT ||--o{ DOCTOR_PROFILE : contains
  DOCTOR_PROFILE ||--o{ AVAILABILITY : sets
  USER ||--o{ APPOINTMENT : books
  DOCTOR_PROFILE ||--o{ APPOINTMENT : attends
  APPOINTMENT ||--o{ REMINDER : schedules
  USER ||--o{ NOTIFICATION : receives
  APPOINTMENT o|--o{ NOTIFICATION : references
  USER ||--o{ WAITLIST : joins
  DOCTOR_PROFILE ||--o{ WAITLIST : receives
  USER ||--o| NOTIFICATION_PREFERENCE : configures

  USER {
    string id PK
    string name
    string email UK
    string phone
    string passwordHash
    enum role
    datetime createdAt
  }
  DEPARTMENT {
    string id PK
    string name UK
  }
  DOCTOR_PROFILE {
    string id PK
    string userId FK
    string departmentId FK
    string specialization
    string bio
  }
  AVAILABILITY {
    string id PK
    string doctorId FK
    int dayOfWeek
    string startTime
    string endTime
    int slotMinutes
  }
  APPOINTMENT {
    string id PK
    string patientId FK
    string doctorId FK
    datetime startAt
    datetime endAt
    enum status
    enum confirmationStatus
    datetime confirmedAt
    string actionToken UK
    string reason
  }
  REMINDER {
    string id PK
    string appointmentId FK
    enum type
    datetime scheduledFor
    datetime sentAt
    enum status
    int attempts
    string errorMessage
  }
  NOTIFICATION {
    string id PK
    string userId FK
    string appointmentId FK
    string title
    string message
    boolean read
    datetime createdAt
  }
  WAITLIST {
    string id PK
    string patientId FK
    string doctorId FK
    date date
    enum status
    string claimToken UK
    datetime notifiedAt
  }
  NOTIFICATION_PREFERENCE {
    string id PK
    string userId FK
    boolean emailEnabled
    boolean inAppEnabled
  }
```

The appointment table has an index on doctor and start time and a partial unique database index for active appointments. That index excludes rows with `CANCELLED` status, allowing a freed time to be booked again while preventing concurrent active bookings. The partial index is added in the SQL migration because Prisma schema syntax cannot express its predicate directly.
