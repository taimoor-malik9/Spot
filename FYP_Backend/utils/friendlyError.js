// friendlyError.js
//
// server.js currently does `res.status(500).json({ error: err.message })`
// in every catch block — the raw internal error string, verbatim, straight
// to the person using the app. toFriendlyError() maps the errors we
// actually expect to see (DB not connected, simulation engine unreachable,
// bad process ID, etc.) to a plain-language message with a suggested next
// step. `detail` keeps the original message around for logs/devtools —
// it's just never the thing shown to the user by default.
//
// Add a new pattern here whenever a raw error makes it to a user in the
// wild instead of guessing everything up front.

function toFriendlyError(err) {
  const msg = err?.message || String(err || 'Unknown error');

  if (/buffering timed out/i.test(msg)) {
    return {
      userMessage: "We couldn't reach the database right now. This is usually temporary — please try again in a moment.",
      detail: msg,
    };
  }

  if (/ECONNREFUSED/i.test(msg) && /(simulation engine|127\.0\.0\.1:8000|localhost:8000)/i.test(msg)) {
    return {
      userMessage: "The simulation engine isn't reachable right now. If you're running this locally, make sure it's started (`uvicorn api:app`).",
      detail: msg,
    };
  }

  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(msg)) {
    return {
      userMessage: "Couldn't connect to a service this needs. Please try again shortly — if it keeps happening, something on our end likely needs restarting.",
      detail: msg,
    };
  }

  if (/Simulation engine error: 5\d\d/i.test(msg)) {
    return {
      userMessage: "The simulation engine hit an internal error while running your process. Try re-running it — if it keeps happening, there may be an issue with your model's data (e.g. a task with no valid resource, or a broken connection).",
      detail: msg,
    };
  }

  if (/Simulation engine error: 4\d\d/i.test(msg)) {
    return {
      userMessage: "The simulation engine rejected this process — something in the model or simulation settings isn't valid. Double-check durations, resources, and gateway probabilities.",
      detail: msg,
    };
  }

  if (/Process not found/i.test(msg)) {
    return {
      userMessage: "We couldn't find that process — it may have been deleted, or this link is out of date.",
      detail: msg,
    };
  }

  if (/Cast to ObjectId failed/i.test(msg)) {
    return {
      userMessage: "That process link doesn't look valid. Try going back and reopening it from your process list.",
      detail: msg,
    };
  }

  if (/ValidationError/i.test(msg)) {
    return {
      userMessage: "Some of the data in this process is in an unexpected format. Try re-saving it from the Model tab, and check any fields you recently edited.",
      detail: msg,
    };
  }

  // Unknown error — never show a raw stack-style string with no context,
  // but be honest that it's unrecognized rather than pretending to know
  // exactly what happened.
  return {
    userMessage: 'Something went wrong on our end. Please try again — if it keeps happening, let us know.',
    detail: msg,
  };
}

module.exports = { toFriendlyError };
