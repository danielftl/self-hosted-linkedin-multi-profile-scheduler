import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  authorizationUrl, makeOAuthState, exchangeAuthorizationCode,
  getLinkedInMember, publishLinkedInText, encryptToken, decryptToken
} from '../src/linkedin.mjs';
import { processDuePosts } from '../src/scheduler.mjs';

const response = (status, data, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: new Headers(headers),
  text: async () => JSON.stringify(data)
});

test('OAuth URL requests profile and publishing permission with CSRF state', () => {
  const state = makeOAuthState();
  assert.ok(state.length >= 40);
  const url = new URL(authorizationUrl({
    clientId: 'client', redirectUri: 'https://example.test/callback', state
  }));
  assert.equal(url.searchParams.get('state'), state);
  assert.ok(url.searchParams.get('scope').includes('w_member_social'));
  assert.equal(url.searchParams.get('response_type'), 'code');
});

test('OAuth exchanges code without exposing client secret in URL', async () => {
  let seen;
  const result = await exchangeAuthorizationCode({
    clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.test/callback',
    code: 'authorization-code', fetchImpl: async (url, options) => {
      seen = { url, options };
      return response(200, { access_token: 'abc', expires_in: 5184000 });
    }
  });
  assert.equal(result.access_token, 'abc');
  assert.ok(!seen.url.includes('secret'));
  assert.equal(seen.options.body.get('client_secret'), 'secret');
});

test('LinkedIn member identity becomes person URN', async () => {
  const member = await getLinkedInMember({
    accessToken: 'token', fetchImpl: async () => response(200, { sub: 'member_12', name: 'Tester' })
  });
  assert.equal(member.personUrn, 'urn:li:person:member_12');
});

test('publishing sends the correct payload but no real post', async () => {
  let sent;
  const result = await publishLinkedInText({
    accessToken: 'test', personUrn: 'urn:li:person:member_12', text: 'Scheduled example',
    fetchImpl: async (url, options) => {
      sent = { url, options };
      return response(201, {}, { 'x-restli-id': 'urn:li:share:123' });
    }
  });
  assert.equal(result.postId, 'urn:li:share:123');
  assert.equal(sent.options.method, 'POST');
  assert.equal(JSON.parse(sent.options.body).commentary, 'Scheduled example');
});

test('LinkedIn error status is preserved for retry decisions', async () => {
  await assert.rejects(
    publishLinkedInText({
      accessToken: 'test', personUrn: 'urn:li:person:member_12', text: 'hello',
      fetchImpl: async () => response(429, { message: 'Rate limit' })
    }),
    error => error.status === 429
  );
});

test('tokens encrypt and decrypt and reject wrong keys', () => {
  const key = crypto.randomBytes(32).toString('base64');
  const encrypted = encryptToken('private-token', key);
  assert.ok(!encrypted.includes('private-token'));
  assert.equal(decryptToken(encrypted, key), 'private-token');
  assert.throws(() => decryptToken(encrypted, crypto.randomBytes(32).toString('base64')));
});

test('worker publishes due jobs once', async () => {
  const jobs = [{ id: '1', attempts: 0 }];
  const published = [];
  const storage = {
    claimDue: async () => jobs.shift() ?? null,
    markPublished: async (id, postId) => published.push({ id, postId }),
    markRetry: async () => { throw Error('unexpected retry'); },
    markFailed: async () => { throw Error('unexpected failure'); }
  };
  const result = await processDuePosts({ storage, publisher: async () => ({ postId: 'post1' }) });
  assert.deepEqual(result, [{ id: '1', status: 'published' }]);
  assert.deepEqual(published, [{ id: '1', postId: 'post1' }]);
});

test('worker retries temporary errors but fails permanent errors', async () => {
  const jobs = [{ id: '1', attempts: 0 }, { id: '2', attempts: 0 }];
  const results = [];
  const storage = {
    claimDue: async () => jobs.shift() ?? null,
    markPublished: async () => { throw Error('unexpected publication'); },
    markRetry: async (id, next, message) => results.push({ id, kind: 'retry', next, message }),
    markUncertain: async id => results.push({ id, kind: 'uncertain' }),
    markFailed: async (id, message) => results.push({ id, kind: 'failed', message })
  };
  await processDuePosts({ storage, publisher: async job => {
    const e = Error('test');
    e.status = job.id === '1' ? 429 : 403;
    throw e;
  }, now: () => new Date('2026-10-30T12:00:00Z') });
  assert.equal(results[0].kind, 'retry');
  assert.equal(results[0].next.toISOString(), '2026-10-30T12:00:30.000Z');
  assert.equal(results[1].kind, 'failed');
});
