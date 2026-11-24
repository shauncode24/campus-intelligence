// P0-7: calendar events are all-day, strictly validated, and never mix up two users' credentials.
import { google } from "googleapis";
process.env.GOOGLE_CLIENT_ID = "id"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.GOOGLE_REDIRECT_URI = "http://localhost/cb";
const svc = await import("../../services/calendarService.js");

let fails = 0;
const check = (n, ok) => { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) fails++; };

// ---- date validation
const now = new Date("2026-11-25T10:00:00Z");
check("a real future date is valid", svc.isValidFutureDate("2026-12-01", now));
check("today is valid", svc.isValidFutureDate("2026-11-25", now));
check("yesterday (UTC) is still valid for students west of Greenwich", svc.isValidFutureDate("2026-11-24", now));
check("two days ago is not", !svc.isValidFutureDate("2026-11-23", now));
for (const bad of ["2026-02-31", "2026-13-01", "12/01/2026", "tomorrow", "", null, undefined, 20261201, "2026-12-01T00:00:00Z", "2026-1-5"])
  check(`rejects ${JSON.stringify(bad)}`, !svc.isValidFutureDate(bad, now));

// ---- cleaning what the browser sent
const future = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
let c = svc.cleanEventData({ title: "  Fee deadline ", date: future, description: "x".repeat(5000), sourceDocument: "y".repeat(500) });
check("clean: trims and limits lengths", c.ok && c.event.title === "Fee deadline" && c.event.description.length === 2000 && c.event.sourceDocument.length === 200);
check("clean: missing source gets a default", svc.cleanEventData({ title: "t", date: future }).event.sourceDocument === "Campus documents");
check("clean: no title refused", !svc.cleanEventData({ title: "  ", date: future }).ok);
check("clean: non-string title refused", !svc.cleanEventData({ title: { a: 1 }, date: future }).ok);
check("clean: bad date refused", !svc.cleanEventData({ title: "t", date: "next friday" }).ok);
check("clean: not an object refused", !svc.cleanEventData("x").ok && !svc.cleanEventData(null).ok);

// ---- the event that is sent, and credentials per request
const inserted = [];
google.calendar = ({ auth }) => ({
  events: {
    insert: async ({ resource }) => {
      const before = auth.credentials.access_token;
      await new Promise((r) => setTimeout(r, 20));          // let the other request run in between
      inserted.push({ resource, tokenAtStart: before, tokenAtEnd: auth.credentials.access_token });
      return { data: { id: "e1" } };
    },
  },
});
await Promise.all([
  svc.createCalendarEvent({ access_token: "TOKEN-A" }, { title: "A", date: "2026-12-31", description: "d", sourceDocument: "Doc A" }),
  svc.createCalendarEvent({ access_token: "TOKEN-B" }, { title: "B", date: "2027-01-05", description: "d", sourceDocument: "Doc B" }),
]);
const a = inserted.find((i) => i.resource.summary === "A"), b = inserted.find((i) => i.resource.summary === "B");
check("two simultaneous users keep their own credentials", a.tokenAtStart === "TOKEN-A" && a.tokenAtEnd === "TOKEN-A" && b.tokenAtStart === "TOKEN-B" && b.tokenAtEnd === "TOKEN-B");
check("event is all-day (date, not dateTime)", a.resource.start.date === "2026-12-31" && !a.resource.start.dateTime && !a.resource.start.timeZone);
check("all-day end is the next day (across a year end too)", a.resource.end.date === "2027-01-01" && b.resource.end.date === "2027-01-06");
check("leap day end", await (async () => { inserted.length = 0; await svc.createCalendarEvent({}, { title: "L", date: "2028-02-28", description: "", sourceDocument: "S" }); return inserted[0].resource.end.date === "2028-02-29"; })());
check("source is in the description", a.resource.description.includes("Source: Doc A"));

console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
