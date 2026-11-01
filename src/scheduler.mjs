// Storage is an adapter; hosted implementations must preserve atomic claim semantics.
export async function processDuePosts({ storage, publisher, now = () => new Date(), maxAttempts = 4, maxJobs = 100, shouldStop = () => false }) {
  const outcomes = [];
  for (let count=0; count<maxJobs && !shouldStop(); count++) {
    const job = await storage.claimDue(now());
    if (!job) break;
    let result;
    try { result = await publisher(job); }
    catch (error) {
      const attempt = (job.attempts ?? 0) + 1;
      if (error.status === 429 && attempt < maxAttempts) {
        const seconds = Math.max(error.retryAfter || 0, Math.min(3600, 30 * 2 ** (attempt-1)));
        await storage.markRetry(job.id, new Date(now().getTime()+seconds*1000), 'HTTP 429');
        outcomes.push({id:job.id,status:'retry'});
      } else if (!error.status || error.status === 408 || error.status >= 500) {
        await storage.markUncertain(job.id);
        outcomes.push({id:job.id,status:'uncertain'});
      } else {
        await storage.markFailed(job.id, error.status === 401 ? 'Reconnect account' : 'HTTP '+error.status);
        outcomes.push({id:job.id,status:'failed'});
      }
      continue;
    }
    // Persistence failures after a successful send must never trigger another send.
    await storage.markPublished(job.id, result.postId ?? null);
    // Media is removed only after the published status is durably recorded.
    // Cleanup errors cannot cause a duplicate publication.
    if(result.cleanup)try{await result.cleanup();}catch{ /* retained for later cleanup */ }
    outcomes.push({id:job.id,status:'published'});
  }
  return outcomes;
}
