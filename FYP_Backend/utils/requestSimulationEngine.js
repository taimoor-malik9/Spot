const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Call the simulation engine with bounded retries for transient Render/network
 * failures. Validation responses such as 400 are returned immediately.
 */
async function requestSimulationEngine(url, options = {}, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let retryDelay = attempt * 1000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
      });

      if (!RETRYABLE_STATUSES.has(response.status) || attempt === attempts) {
        return response;
      }

      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        retryDelay = Math.min(retryAfterSeconds * 1000, 10000);
      }
      lastError = new Error(`Simulation engine returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    } finally {
      clearTimeout(timeout);
    }

    await wait(retryDelay);
  }

  throw lastError || new Error('Simulation engine request failed');
}

module.exports = { requestSimulationEngine };
