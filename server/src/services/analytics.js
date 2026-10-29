const prisma = require('../lib/prisma');

const STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];
const CONFIRMATION_STATUSES = ['UNCONFIRMED', 'CONFIRMED_BY_PATIENT'];

function toPercent(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

async function getAnalyticsSummary(range) {
  const where = { startAt: { gte: range.startAt, lt: range.endAt } };
  const [total, groupedStatuses, groupedOutcomes, groupedWaitlist] = await prisma.$transaction([
    prisma.appointment.count({ where }),
    prisma.appointment.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.appointment.groupBy({
      by: ['confirmationStatus', 'status'],
      where: { ...where, status: { in: ['COMPLETED', 'NO_SHOW'] } },
      _count: { _all: true },
    }),
    prisma.waitlist.groupBy({
      by: ['status'],
      where: {
        notifiedAt: { gte: range.startAt, lt: range.endAt },
        status: { in: ['BOOKED', 'EXPIRED', 'CANCELLED', 'NOTIFIED'] },
      },
      _count: { _all: true },
    }),
  ]);

  const statusCounts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const group of groupedStatuses) statusCounts[group.status] = group._count._all;
  const outcomeCounts = Object.fromEntries(CONFIRMATION_STATUSES.map((confirmationStatus) => [confirmationStatus, { completed: 0, noShow: 0 }]));
  for (const group of groupedOutcomes) {
    outcomeCounts[group.confirmationStatus][group.status === 'NO_SHOW' ? 'noShow' : 'completed'] = group._count._all;
  }
  const completed = statusCounts.COMPLETED;
  const noShow = statusCounts.NO_SHOW;
  const outcomes = completed + noShow;
  const confirmationBreakdown = CONFIRMATION_STATUSES.map((confirmationStatus) => {
    const counts = outcomeCounts[confirmationStatus];
    const denominator = counts.completed + counts.noShow;
    return { confirmationStatus, completed: counts.completed, noShow: counts.noShow, outcomeCount: denominator, noShowRate: toPercent(counts.noShow, denominator) };
  });
  const waitlistCounts = { BOOKED: 0, EXPIRED: 0, CANCELLED: 0, NOTIFIED: 0 };
  for (const group of groupedWaitlist) waitlistCounts[group.status] = group._count._all;
  const resolvedOffers = waitlistCounts.BOOKED + waitlistCounts.EXPIRED + waitlistCounts.CANCELLED;

  return {
    summary: {
      total,
      cancelled: statusCounts.CANCELLED,
      completed,
      noShow,
      cancellationRate: toPercent(statusCounts.CANCELLED, total),
      noShowRate: toPercent(noShow, outcomes),
      outcomeCount: outcomes,
    },
    statusCounts,
    confirmationBreakdown,
    waitlist: {
      offers: resolvedOffers + waitlistCounts.NOTIFIED,
      claimed: waitlistCounts.BOOKED,
      expired: waitlistCounts.EXPIRED,
      withdrawn: waitlistCounts.CANCELLED,
      active: waitlistCounts.NOTIFIED,
      resolved: resolvedOffers,
      fillRate: toPercent(waitlistCounts.BOOKED, resolvedOffers),
    },
  };
}

async function getAppointmentPatterns(range) {
  const [weekdayRows, hourRows, doctorRows, departmentRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT EXTRACT(ISODOW FROM (a."startAt" + INTERVAL '1 hour'))::int AS "weekday",
             COUNT(*)::int AS "count"
      FROM "Appointment" a
      WHERE a."startAt" >= ${range.startAt} AND a."startAt" < ${range.endAt}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT EXTRACT(HOUR FROM (a."startAt" + INTERVAL '1 hour'))::int AS "hour",
             COUNT(*)::int AS "count"
      FROM "Appointment" a
      WHERE a."startAt" >= ${range.startAt} AND a."startAt" < ${range.endAt}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT dp."id" AS "doctorId", u."name" AS "doctorName", d."name" AS "departmentName",
             COUNT(*)::int AS "count"
      FROM "Appointment" a
      JOIN "DoctorProfile" dp ON dp."id" = a."doctorId"
      JOIN "User" u ON u."id" = dp."userId"
      JOIN "Department" d ON d."id" = dp."departmentId"
      WHERE a."startAt" >= ${range.startAt} AND a."startAt" < ${range.endAt}
      GROUP BY dp."id", u."name", d."name"
      ORDER BY COUNT(*) DESC, u."name" ASC
    `,
    prisma.$queryRaw`
      SELECT d."id" AS "departmentId", d."name" AS "departmentName", COUNT(*)::int AS "count"
      FROM "Appointment" a
      JOIN "DoctorProfile" dp ON dp."id" = a."doctorId"
      JOIN "Department" d ON d."id" = dp."departmentId"
      WHERE a."startAt" >= ${range.startAt} AND a."startAt" < ${range.endAt}
      GROUP BY d."id", d."name"
      ORDER BY COUNT(*) DESC, d."name" ASC
    `,
  ]);

  const weekdayCounts = new Map(weekdayRows.map((row) => [row.weekday, row.count]));
  const hourCounts = new Map(hourRows.map((row) => [row.hour, row.count]));
  return {
    weekdays: Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, count: weekdayCounts.get(index + 1) || 0 })),
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hourCounts.get(hour) || 0 })),
    doctors: doctorRows,
    departments: departmentRows,
  };
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function analyticsCsv(range, report, patterns) {
  const rows = [['Report section', 'Category', 'Detail', 'Count', 'Rate (%)']];
  rows.push(['Period', 'Nigeria local date range', `${range.from} to ${range.to}`, '', '']);
  for (const [status, count] of Object.entries(report.statusCounts)) rows.push(['Appointment status', status, '', count, '']);
  rows.push(['Metric', 'Cancellation rate', 'Cancelled / all appointments', report.summary.cancelled, report.summary.cancellationRate ?? '']);
  rows.push(['Metric', 'No-show rate', 'No-shows / completed and no-show visits', report.summary.noShow, report.summary.noShowRate ?? '']);
  rows.push(['Waitlist', 'Slot fill rate', 'Claimed / resolved offers', report.waitlist.claimed, report.waitlist.fillRate ?? '']);
  rows.push(['Waitlist', 'Offers', 'All offers in selected period', report.waitlist.offers, '']);
  rows.push(['Waitlist', 'Expired', '', report.waitlist.expired, '']);
  rows.push(['Waitlist', 'Withdrawn', '', report.waitlist.withdrawn, '']);
  rows.push(['Waitlist', 'Still active', '', report.waitlist.active, '']);
  for (const item of report.confirmationBreakdown) {
    rows.push(['Confirmation comparison', item.confirmationStatus, `${item.noShow} no-show / ${item.outcomeCount} outcomes`, item.noShow, item.noShowRate ?? '']);
  }
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  for (const item of patterns.weekdays) rows.push(['By weekday', weekdays[item.weekday - 1], '', item.count, '']);
  for (const item of patterns.hours) rows.push(['By hour', `${String(item.hour).padStart(2, '0')}:00 Nigeria time`, '', item.count, '']);
  for (const item of patterns.doctors) rows.push(['By doctor', item.doctorName, item.departmentName, item.count, '']);
  for (const item of patterns.departments) rows.push(['By department', item.departmentName, '', item.count, '']);
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

module.exports = { getAnalyticsSummary, getAppointmentPatterns, analyticsCsv };
