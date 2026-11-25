// The reference ("ref") of a failed server call, so a student can quote it and whoever runs the
// service can find the failure in the logs. Pure functions (testable with `node --test`).

/** "Something went wrong (ref ab12cd34)" -> "ab12cd34" */
export function refFromMessage(message) {
  const found = /\(ref ([A-Za-z0-9-]{6,})\)/.exec(String(message || ""));
  return found ? found[1] : null;
}

/** Add " (ref X)" to a user message unless it already carries one. */
export function withRef(message, ref) {
  if (!ref || /\(ref /.test(message)) return message;
  return `${message} (ref ${ref})`;
}

/** The ref of the latest failure if it is recent enough to be the one the user is looking at. */
export function freshRef(failure, now = Date.now(), maxAgeMs = 15000) {
  return failure && failure.ref && now - failure.at < maxAgeMs ? failure.ref : null;
}
