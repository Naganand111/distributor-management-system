/**
 * Customer period filters.
 *
 * The caller supplies an enum *name*. The matching SQL fragment lives here
 * on the server, so a customer can never influence the query text.
 */

export const PERIOD = Object.freeze({
  ALL: "all",
  TODAY: "today",
  YESTERDAY: "yesterday",
  LAST_7_DAYS: "last_7_days",
  LAST_WEEK: "last_week",
  THIS_MONTH: "this_month",
  LAST_MONTH: "last_month",
});

export const PERIODS = Object.freeze({
  [PERIOD.ALL]: { sql: "", label: "" },
  [PERIOD.TODAY]: { sql: "AND DATE(o.created_at) = CURDATE()", label: "placed today" },
  [PERIOD.YESTERDAY]: {
    sql: "AND DATE(o.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)",
    label: "placed yesterday",
  },
  [PERIOD.LAST_7_DAYS]: {
    sql: "AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)",
    label: "placed in the last 7 days",
  },
  [PERIOD.LAST_WEEK]: {
    /* Previous CALENDAR week: Monday 00:00 up to (not including) this
       week's Monday 00:00. Everything is computed inside SQL from
       CURDATE()/WEEKDAY(), never from caller-supplied date text. */
    sql:
      "AND o.created_at >= DATE_SUB(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY) " +
      "AND o.created_at < DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)",
    label: "placed last week",
  },
  [PERIOD.THIS_MONTH]: {
    sql: "AND o.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')",
    label: "placed this month",
  },
  [PERIOD.LAST_MONTH]: {
    sql:
      "AND o.created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01') " +
      "AND o.created_at < DATE_FORMAT(CURDATE(), '%Y-%m-01')",
    label: "placed last month",
  },
});

export const PERIOD_NAMES = Object.freeze(Object.keys(PERIODS));

/**
 * Map a user's question onto a period enum name.
 * Keep the match order in sync with the customer assistant's question parsing.
 */
export function detectPeriod(message) {
  const msg = String(message || "").toLowerCase();

  if (/\btoday\b|\bthis morning\b/.test(msg)) return PERIOD.TODAY;
  if (/\byesterday\b/.test(msg)) return PERIOD.YESTERDAY;
  if (/\bthis week\b|\blast 7 days\b|\bpast week\b/.test(msg)) return PERIOD.LAST_7_DAYS;
  /* "last week" means the previous calendar week, deliberately distinct
     from the rolling "last 7 days" / "past week" match above. */
  if (/\blast week\b|\bprevious week\b/.test(msg)) return PERIOD.LAST_WEEK;
  if (/\bthis month\b|\bcurrent month\b/.test(msg)) return PERIOD.THIS_MONTH;
  if (/\blast month\b/.test(msg)) return PERIOD.LAST_MONTH;

  return PERIOD.ALL;
}
