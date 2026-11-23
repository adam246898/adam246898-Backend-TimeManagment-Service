// Calendar dates are plain "YYYY-MM-DD" strings in the user's time zone (contract 3.5).
// All arithmetic is done in UTC on those strings, so daylight-saving changes never shift a day.
// Because the format is fixed-width, two dates can be compared with < and >.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// The calendar date of an instant (a Date) in a time zone.
function dateInTimeZone(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const todayIn = (tz, now = new Date()) => dateInTimeZone(now, tz);

function toMs(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);

const addDays = (date, n) => fromMs(toMs(date) + n * DAY_MS);

// Number of days from a to b (b - a). diffDays('2026-11-01', '2026-11-03') === 2
const diffDays = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY_MS);

function isValidDate(date) {
  return typeof date === 'string' && DATE_RE.test(date) && fromMs(toMs(date)) === date;
}

// 'mon' ... 'sun'
function weekdayOf(date) {
  const jsDay = new Date(toMs(date)).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(jsDay + 6) % 7];
}

// First day of the week that contains `date`. The user's setting (X-User-Week-Starts-On) decides
// whether weeks start on Sunday or Monday; Sunday is the default, as in habits-service and the
// contract's user settings (4.1). All three services must use the same rule for times_per_week.
function weekStart(date, weekStartsOn = 'sunday') {
  const index = WEEKDAYS.indexOf(weekdayOf(date)); // mon = 0 ... sun = 6
  const back = weekStartsOn === 'monday' ? index : (index + 1) % 7;
  return addDays(date, -back);
}

function eachDay(from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

const isValidMonth = (month) => typeof month === 'string' && MONTH_RE.test(month);

function monthBounds(month) {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const last = fromMs(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
  return { first, last };
}

// Months counted from year 0, so two months can be subtracted.
function monthIndex(month) {
  const [y, m] = month.split('-').map(Number);
  return y * 12 + (m - 1);
}

const minDate = (a, b) => (a < b ? a : b);
const maxDate = (a, b) => (a > b ? a : b);

module.exports = {
  WEEKDAYS,
  isValidTimeZone,
  dateInTimeZone,
  todayIn,
  addDays,
  diffDays,
  isValidDate,
  weekdayOf,
  weekStart,
  eachDay,
  isValidMonth,
  monthBounds,
  monthIndex,
  minDate,
  maxDate,
};
