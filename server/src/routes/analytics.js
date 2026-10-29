const { Router } = require('express');
const { authenticate, requireRole } = require('../middleware/authenticate');
const { parseDateOnly, lagosDateString, lagosDateTime } = require('../services/scheduling');
const { getAnalyticsSummary, getAppointmentPatterns, analyticsCsv } = require('../services/analytics');

const router = Router();

function getPeriod(query) {
  const today = lagosDateString(new Date());
  const to = typeof query.to === 'string' ? query.to : today;
  const toParts = parseDateOnly(to);
  const defaultFromDate = toParts && new Date(toParts.date.getTime() - 29 * 86_400_000);
  const defaultFrom = defaultFromDate && `${defaultFromDate.getUTCFullYear()}-${String(defaultFromDate.getUTCMonth() + 1).padStart(2, '0')}-${String(defaultFromDate.getUTCDate()).padStart(2, '0')}`;
  const from = typeof query.from === 'string' ? query.from : defaultFrom;
  const fromDate = parseDateOnly(from);
  const toDate = parseDateOnly(to);
  if (!fromDate || !toDate || fromDate.date > toDate.date) return null;
  const days = (toDate.date.getTime() - fromDate.date.getTime()) / 86_400_000 + 1;
  if (days > 366) return null;
  const nextDay = new Date(toDate.date.getTime() + 86_400_000);
  return {
    from,
    to,
    startAt: lagosDateTime(fromDate, '00:00'),
    endAt: lagosDateTime({ year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1, day: nextDay.getUTCDate() }, '00:00'),
  };
}

function validatePeriod(req, res) {
  const period = getPeriod(req.query);
  if (!period) {
    res.status(400).json({ success: false, message: 'Choose a valid date range of no more than 366 days, with the start date before the end date.' });
    return null;
  }
  return period;
}

router.use(authenticate, requireRole('ADMIN'));

router.get('/summary', async (req, res, next) => {
  const period = validatePeriod(req, res);
  if (!period) return;
  try {
    const report = await getAnalyticsSummary(period);
    return res.json({ success: true, period: { from: period.from, to: period.to, timeZone: 'Africa/Lagos' }, ...report });
  } catch (error) { return next(error); }
});

router.get('/patterns', async (req, res, next) => {
  const period = validatePeriod(req, res);
  if (!period) return;
  try {
    const patterns = await getAppointmentPatterns(period);
    return res.json({ success: true, period: { from: period.from, to: period.to, timeZone: 'Africa/Lagos' }, patterns });
  } catch (error) { return next(error); }
});

router.get('/export.csv', async (req, res, next) => {
  const period = validatePeriod(req, res);
  if (!period) return;
  try {
    const [report, patterns] = await Promise.all([getAnalyticsSummary(period), getAppointmentPatterns(period)]);
    const csv = analyticsCsv(period, report, patterns);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="careslot-analytics-${period.from}-to-${period.to}.csv"`);
    return res.send(csv);
  } catch (error) { return next(error); }
});

module.exports = router;
