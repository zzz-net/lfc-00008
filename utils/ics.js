const crypto = require('crypto');
const { ICS_DEFAULT_TIMEZONE, ICS_PRODUCT_ID, ICS_CAL_NAME, ICS_REFRESH_INTERVAL_HOURS, ICS_FIELD_MAPPING } = require('../config');

function escapeIcsText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function formatIcsDateTime(dtStr) {
  if (dtStr instanceof Date) {
    if (isNaN(dtStr.getTime())) return '';
    return dtStr.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  if (!dtStr) return '';
  const cleaned = String(dtStr).replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace(/Z$/, '');
  if (/^\d{8}T\d{6}$/.test(cleaned)) return cleaned;
  const d = new Date(dtStr);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function formatIcsUtc(dtStr) {
  const d = dtStr instanceof Date ? dtStr : new Date(dtStr);
  if (isNaN(d.getTime())) return '';
  const formatted = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return formatted.endsWith('Z') ? formatted : formatted + 'Z';
}

function generateUid(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}@community-booking`;
}

function generateSubscriptionToken() {
  return crypto.randomBytes(24).toString('hex');
}

function buildVEvent(reservation, tz) {
  const mapping = ICS_FIELD_MAPPING;
  const timezone = tz || ICS_DEFAULT_TIMEZONE;

  const uid = String(reservation[mapping.uid] || generateUid('res'));

  const summary = escapeIcsText(reservation[mapping.summary] || '活动室预约');

  const location = escapeIcsText(reservation[mapping.location] || '');

  const descParts = [];
  if (Array.isArray(mapping.description)) {
    for (const field of mapping.description) {
      if (reservation[field]) {
        const label = field === 'purpose' ? '目的' : field === 'room_name' ? '房间' : field === 'user_name' ? '预约人' : field === 'status' ? '状态' : field;
        descParts.push(`${label}: ${reservation[field]}`);
      }
    }
  } else if (reservation[mapping.description]) {
    descParts.push(reservation[mapping.description]);
  }
  if (reservation.attendees) {
    descParts.push(`参与人数: ${reservation.attendees}`);
  }
  const description = escapeIcsText(descParts.join('\\n'));

  const dtStart = formatIcsDateTime(reservation[mapping.dtstart]);
  const dtEnd = formatIcsDateTime(reservation[mapping.dtend]);

  const organizer = reservation[mapping.organizer]
    ? `ORGANIZER;CN=${escapeIcsText(reservation[mapping.organizer])}:mailto:${escapeIcsText(reservation.user_name)}@community-booking.local`
    : '';

  let lines = [
    'BEGIN:VEVENT',
    `UID:${uid}@community-booking`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    `DTSTART;TZID=${timezone}:${dtStart}`,
    `DTEND;TZID=${timezone}:${dtEnd}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${description}`
  ];

  if (organizer) {
    lines.push(organizer);
  }

  const validStatuses = ['approved', 'checked_in', 'completed', 'pending'];
  if (reservation.status === 'canceled') {
    lines.push('STATUS:CANCELLED');
    lines.push('METHOD:CANCEL');
  } else if (validStatuses.includes(reservation.status)) {
    lines.push('STATUS:CONFIRMED');
  }

  lines.push('END:VEVENT');

  return lines.join('\r\n');
}

function generateSingleIcs(reservation, tz) {
  const productId = ICS_PRODUCT_ID;
  const vevent = buildVEvent(reservation, tz);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${productId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    vevent,
    'END:VCALENDAR'
  ].join('\r\n');
}

function generateSubscriptionIcs(reservations, tz) {
  const productId = ICS_PRODUCT_ID;
  const calName = ICS_CAL_NAME;
  const refreshInterval = ICS_REFRESH_INTERVAL_HOURS;

  const vevents = reservations.map(r => buildVEvent(r, tz));

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${productId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    `X-PUBLISHED-TTL:PT${refreshInterval}H`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refreshInterval}H`,
    ...vevents,
    'END:VCALENDAR'
  ].join('\r\n');
}

function generateRoomIcs(reservations, roomName, tz) {
  const productId = ICS_PRODUCT_ID;
  const calName = `${ICS_CAL_NAME} - ${roomName}`;
  const refreshInterval = ICS_REFRESH_INTERVAL_HOURS;

  const vevents = reservations.map(r => buildVEvent(r, tz));

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${productId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    `X-PUBLISHED-TTL:PT${refreshInterval}H`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refreshInterval}H`,
    ...vevents,
    'END:VCALENDAR'
  ].join('\r\n');
}

module.exports = {
  generateSingleIcs,
  generateSubscriptionIcs,
  generateRoomIcs,
  generateSubscriptionToken,
  escapeIcsText,
  formatIcsDateTime,
  buildVEvent
};
