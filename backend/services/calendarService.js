import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Google Calendar Service
 * Handles OAuth flow and event creation
 */

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

/**
 * Generate OAuth URL for user authorization
 * @returns {string} Authorization URL
 */
export function getAuthUrl() {
  const scopes = ['https://www.googleapis.com/auth/calendar.events'];
  
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code from Google
 * @returns {Promise<Object>} Tokens object
 */
export async function getTokensFromCode(code) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Create calendar event
 * @param {Object} tokens - User's OAuth tokens
 * @param {Object} eventData - Event details
 * @returns {Promise<Object>} Created event
 */
export async function createCalendarEvent(tokens, eventData) {
  // Set credentials for this request
  oauth2Client.setCredentials(tokens);
  
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  
  const { title, date, description, sourceDocument } = eventData;
  
  // Parse date string (expecting YYYY-MM-DD or similar)
  const eventDate = new Date(date);
  
  // Set to 9 AM on that day
  const startDateTime = new Date(eventDate);
  startDateTime.setHours(9, 0, 0);
  
  // Event lasts 1 hour
  const endDateTime = new Date(startDateTime);
  endDateTime.setHours(10, 0, 0);
  
  const event = {
    summary: title,
    description: `${description}\n\nSource: ${sourceDocument}`,
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: 'UTC',
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: 'UTC',
    },
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
 * Validate if a date string is a valid future date
 * @param {string} dateStr - Date string to validate
 * @returns {boolean}
 */
export function isValidFutureDate(dateStr) {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    
    // Check if date is valid and in the future
    return date instanceof Date && !isNaN(date) && date > now;
  } catch (error) {
    return false;
  }
}