// calendar.js — "Add to calendar" export (RFC 5545). One VEVENT per match,
// DTSTART/DTEND in UTC with a fixed 2h duration, CRLF line endings (required
// by the spec — some calendar apps reject \n). Knockout team names come from
// resolveBracketTeams().

import { matchDateUTC } from './app.js';
import { resolveBracketTeams } from './bracket.js';
import { translatePhase } from './i18n.js';

// Date → 20260611T160000Z
function icsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// RFC 5545 TEXT escaping: backslash, comma, semicolon, newline
function icsEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

export function exportMatchToICS(match, stadium) {
  const start = matchDateUTC(match);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const { home, away } = resolveBracketTeams(match);
  const location = stadium ? `${stadium.name}, ${stadium.city}` : match.city;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WorldCup2026Hub//EN',
    'BEGIN:VEVENT',
    `UID:match-${match.id}@worldcup2026hub`,
    `DTSTAMP:${icsDate(start)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(`${home.label} x ${away.label} — ${translatePhase(match.phase)}`)}`,
    `LOCATION:${icsEscape(location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `match-${match.id}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}
