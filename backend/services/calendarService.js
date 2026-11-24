import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Google Calendar Service
 * Handles OAuth flow and event creation.
 *
 * A NEW OAuth client is made for every call. The client holds the user's credentials, so one
 * shared client would let two users' simultaneous requests overwrite each other's tokens and
 * create an event in the wrong person's calendar.
 */
function newOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Generate OAuth URL for user authorization
 * @param {string} state - Opaque, single-use server-side nonce (see calendarRoutes)
 * @returns {string} Authorization URL
 */
export function getAuthUrl(state) {
  const scopes = ['https://www.googleapis.com/auth/calendar.events'];

  return newOAuthClient().generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state
  });
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code from Google
 * @returns {Promise<Object>} Tokens object
 */
export async function getTokensFromCode(code) {
  const { tokens } = await newOAuthClient().getToken(code);
  return tokens;
}

/** Ask Google to revoke a user's calendar tokens (used when they delete their data). */
export async function revokeTokens(tokens) {
  const token = tokens && (tokens.refresh_token || tokens.access_token);
  if (!token) return;
  await newOAuthClient().revokeToken(token);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Is this a real calendar date written YYYY-MM-DD? (2026-02-31 is not.) */
export function isRealDate(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_PATTERN.test(dateStr)) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  return !isNaN(d) && d.toISOString().slice(0, 10) === dateStr;
}

/** Add days to a YYYY-MM-DD date (calendar arithmetic in UTC: no time zone involved). */
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Check and clean what the browser sent for an event. Returns { ok: true, event } with
 * trimmed, length-limited fields, or { ok: false, message }.
 */
export function cleanEventData(eventData) {
  if (!eventData || typeof eventData !== 'object') {
    return { ok: false, message: 'Event details are missing' };
  }
  const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const title = text(eventData.title, 200);
  if (!title) return { ok: false, message: 'The event needs a title' };
  if (!isValidFutureDate(eventData.date)) {
    return { ok: false, message: 'The deadline has already passed or the date is not valid' };
  }
  return {
    ok: true,
    event: {
      title,
      date: eventData.date,
      description: text(eventData.description, 2000),
      sourceDocument: text(eventData.sourceDocument, 200) || 'Campus documents',
    },
  };
}

/**
 * Create an ALL-DAY calendar event.
 * A deadline is a day, not a time: an all-day event has no time zone to get wrong (the old
 * code made a 9:00 event in the server's zone and labelled it UTC).
 * @param {Object} tokens - User's OAuth tokens
 * @param {Object} eventData - Cleaned event details (see cleanEventData)
 * @returns {Promise<Object>} Created event
 */
export async function createCalendarEvent(tokens, eventData) {
  const auth = newOAuthClient();
  auth.setCredentials(tokens);
  const calendar = google.calendar({ version: 'v3', auth });

  const { title, date, description, sourceDocument } = eventData;

  const event = {
    summary: title,
    description: `${description}\n\nSource: ${sourceDocument}`.trim(),
    // all-day: `end` is the day AFTER (exclusive)
    start: { date },
    end: { date: addDays(date, 1) },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 }, // 1 day before
        { method: 'popup', minutes: 60 }, // 1 hour before
      ],
    },
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    resource: event,
  });

  return response.data;
}

/**
 * Is this a real YYYY-MM-DD date that is today or later? "Today" is allowed to be one day
 * behind UTC so a student west of Greenwich can still add today's deadline.
 * @param {string} dateStr
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isValidFutureDate(dateStr, now = new Date()) {
  if (!isRealDate(dateStr)) return false;
  const earliest = addDays(now.toISOString().slice(0, 10), -1);
  return dateStr >= earliest;
}
