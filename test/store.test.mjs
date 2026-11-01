import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { processDuePosts } from '../src/scheduler.mjs';

test('durable job queue claims each job only once', async () => {
  const store = new Store(':memory:');
  try {
    store.upsertAccount({
      id: '123', displayName: 'Tester', personUrn: 'urn:li:person:123',
      encryptedToken: 'encrypted', expiresAt: '2027-01-01T00:00:00Z'
    });
    store.schedule({ id: 'job-1', accountId: '123', content: 'hello',
      scheduledAt: '2026-10-30T00:00:00Z' });
    const now = new Date('2026-10-30T01:00:00Z');
    const first = await store.claimDue(now);
    const second = await store.claimDue(now);
    assert.equal(first.id, 'job-1');
    assert.equal(first.attempts, 0);
    assert.equal(second, null);
    await store.markPublished('job-1', 'post-123');
    assert.equal(store.listJobs()[0].status, 'published');
    assert.equal(store.listJobs()[0].remote_post_id, 'post-123');
  } finally { store.close(); }
});

test('temporary failure is retried, then published', async () => {
  const store = new Store(':memory:');
  try {
    store.upsertAccount({
      id: '123', displayName: 'Tester', personUrn: 'urn:li:person:123',
      encryptedToken: 'encrypted', expiresAt: '2027-01-01T00:00:00Z'
    });
    store.schedule({ accountId: '123', content: 'hello',
      scheduledAt: '2026-10-30T00:00:00Z' });
    const t = new Date('2026-10-30T01:00:00Z');
    await processDuePosts({
      storage: store, now: () => t,
      publisher: async () => { const error = new Error('temporary'); error.status = 429; throw error; }
    });
    assert.equal(store.listJobs()[0].status, 'scheduled');
    assert.equal(store.listJobs()[0].attempts, 1);
    await processDuePosts({
      storage: store, now: () => new Date(t.getTime() + 31_000),
      publisher: async () => ({ postId: 'published' })
    });
    assert.equal(store.listJobs()[0].status, 'published');
    assert.equal(store.listJobs()[0].attempts, 2);
  } finally { store.close(); }
});
