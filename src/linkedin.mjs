import crypto from 'node:crypto';

const AUTH = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO = 'https://api.linkedin.com/v2/userinfo';
const POSTS = 'https://api.linkedin.com/rest/posts';
const SCOPES = ['openid', 'profile', 'email', 'w_member_social'];

export function makeOAuthState() {
  return crypto.randomBytes(32).toString('base64url');
}
export function authorizationUrl({ clientId, redirectUri, state }) {
  for (const value of [clientId, redirectUri, state]) if (!value) throw new Error('Missing OAuth parameter');
  const url = new URL(AUTH);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    state, scope: SCOPES.join(' ')
  }).toString();
  return url.toString();
}
async function requestJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20000) });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
  if (!response.ok) {
    const error = new Error('LinkedIn API returned HTTP ' + response.status);
    error.status = response.status;
    error.retryAfter = Math.min(3600, Math.max(0, Number(response.headers.get('retry-after')) || 0));
    throw error;
  }
  return { body, headers: response.headers, status: response.status };
}
export async function exchangeAuthorizationCode({
  clientId, clientSecret, redirectUri, code, fetchImpl = fetch
}) {
  if (![clientId, clientSecret, redirectUri, code].every(Boolean)) throw new Error('Missing token exchange parameter');
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, client_id: clientId,
    client_secret: clientSecret, redirect_uri: redirectUri
  });
  const { body: result } = await requestJson(fetchImpl, TOKEN, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!result.access_token || !(Number.isFinite(Number(result.expires_in)) && Number(result.expires_in) > 0)) throw new Error('Invalid LinkedIn token response');
  return result;
}
export async function getLinkedInMember({ accessToken, fetchImpl = fetch }) {
  if (!accessToken) throw new Error('Missing access token');
  const { body } = await requestJson(fetchImpl, USERINFO, {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  if (!body.sub || !/^[A-Za-z0-9_-]+$/.test(body.sub)) throw new Error('Invalid LinkedIn member identifier');
  return { id: body.sub, personUrn: 'urn:li:person:' + body.sub, name: body.name ?? '' };
}
export async function publishLinkedInText({
  accessToken, personUrn, text, version = '202610', fetchImpl = fetch
}) {
  if (!accessToken || !/^urn:li:person:[A-Za-z0-9_-]+$/.test(personUrn)) throw new Error('Invalid LinkedIn account');
  if (typeof text !== 'string' || text.length > 3000 || !text.trim()) throw new Error('Post text is required');
  const payload = {
    author: personUrn, commentary: text, visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false
  };
  const { headers, body, status } = await requestJson(fetchImpl, POSTS, {
    method: 'POST', headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'Linkedin-Version': version,
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify(payload)
  });
  const postId=headers.get('x-restli-id')??body.id;
  if(!postId)throw Error('LinkedIn publication ID missing; outcome uncertain');
  return {status,postId};
}
export function encryptToken(plaintext, base64Key) {
  const key = Buffer.from(base64Key ?? '', 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
export function decryptToken(encrypted, base64Key) {
  const key = Buffer.from(base64Key ?? '', 'base64');
  if (key.length !== 32) throw new Error('Invalid token encryption key');
  const data = Buffer.from(encrypted, 'base64');
  if (data.length < 29) throw new Error('Invalid encrypted token');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
