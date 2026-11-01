// Optional minute-level cloud trigger when the Sites host has no native minute scheduler.
// No LinkedIn tokens or database access belong in this worker.
export default {
  async scheduled(_controller, env) {
    if (!env.SITE_TRIGGER_URL || !env.SCHEDULER_TRIGGER_SECRET) throw new Error('Scheduler configuration missing');
    const url = new URL(env.SITE_TRIGGER_URL);
    if (url.protocol !== 'https:') throw new Error('Scheduler endpoint must use HTTPS');
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {'x-scheduler-secret': env.SCHEDULER_TRIGGER_SECRET},
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error('Scheduler endpoint HTTP ' + response.status);
  }
};
