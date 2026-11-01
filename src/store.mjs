import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

export class Store {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        display_name TEXT NOT NULL,
        person_urn TEXT NOT NULL,
        encrypted_token TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        content TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        next_attempt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_until TEXT,
        last_error TEXT,
        remote_post_id TEXT
      );
      CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status,next_attempt);
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        filename TEXT NOT NULL,
        mime TEXT NOT NULL,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL,
        job_id TEXT UNIQUE REFERENCES jobs(id),
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS attachments_orphans ON attachments(job_id,created_at);
      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY, expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        session_hash TEXT PRIMARY KEY,
        csrf TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        oauth_state TEXT,
        oauth_expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    `);
  }
  close() { this.db.close(); }
  sessionHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
  createSession(token, csrf, expiresAt) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(new Date().toISOString());
    if (this.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count >= 1000) throw new Error('Session limit');
    this.db.prepare('INSERT INTO sessions(session_hash,csrf,expires_at) VALUES(?,?,?)')
      .run(this.sessionHash(token), csrf, expiresAt);
  }
  getSession(token, now = new Date()) {
    if (!token) return null;
    return this.db.prepare('SELECT csrf,expires_at FROM sessions WHERE session_hash=? AND expires_at>?')
      .get(this.sessionHash(token), now.toISOString()) ?? null;
  }
  revokeSession(token) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE session_hash=?').run(this.sessionHash(token));
  }
  setSessionOAuth(token, state, expiresAt) {
    const result = this.db.prepare('UPDATE sessions SET oauth_state=?,oauth_expires_at=? WHERE session_hash=? AND expires_at>?')
      .run(state, expiresAt, this.sessionHash(token), new Date().toISOString());
    if (!result.changes) throw new Error('Session expired');
  }
  consumeSessionOAuth(token, state, now = new Date()) {
    if (!token || !state) return false;
    const result = this.db.prepare('UPDATE sessions SET oauth_state=NULL,oauth_expires_at=NULL WHERE session_hash=? AND oauth_state=? AND oauth_expires_at>? AND expires_at>? RETURNING csrf')
      .get(this.sessionHash(token), state, now.toISOString(), now.toISOString());
    return Boolean(result);
  }
  saveOAuthState(state, expiresAt) {
    this.db.prepare('INSERT INTO oauth_states(state,expires_at) VALUES(?,?)').run(state, expiresAt);
  }
  consumeOAuthState(state, now = new Date()) {
    const found = this.db.prepare('DELETE FROM oauth_states WHERE state=? AND expires_at>? RETURNING state').get(state, now.toISOString());
    return Boolean(found);
  }
  upsertAccount({ id, provider = 'linkedin', displayName, personUrn, encryptedToken, expiresAt }) {
    if (provider !== 'linkedin' || personUrn !== 'urn:li:person:' + id) throw new Error('Account identity mismatch');
    this.db.prepare(`INSERT INTO accounts (id,provider,display_name,person_urn,encrypted_token,expires_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      display_name=excluded.display_name,person_urn=excluded.person_urn,
      encrypted_token=excluded.encrypted_token,expires_at=excluded.expires_at`)
      .run(id, provider, displayName, personUrn, encryptedToken, expiresAt);
  }
  getAccount(id) {
    return this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
  }
  listAccounts() {
    return this.db.prepare('SELECT id,provider,display_name,person_urn,expires_at FROM accounts').all();
  }
  saveAttachment({id,accountId,filename,mime,kind,size}) {
    if(!this.getAccount(accountId))throw Error('Unknown account');
    this.db.prepare('INSERT INTO attachments(id,account_id,filename,mime,kind,size,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id,accountId,filename,mime,kind,size,new Date().toISOString());
  }
  getAttachment(id) {
    if(!id)return null;
    return this.db.prepare('SELECT * FROM attachments WHERE id=?').get(id)??null;
  }
  attachmentForJob(jobId) {
    return this.db.prepare('SELECT * FROM attachments WHERE job_id=?').get(jobId)??null;
  }
  markAttachmentDeleted(id) {
    this.db.prepare('UPDATE attachments SET deleted_at=? WHERE id=?').run(new Date().toISOString(),id);
  }
  mediaForCleanup(cutoff) {
    return this.db.prepare(`SELECT attachments.id FROM attachments
      LEFT JOIN jobs ON jobs.id=attachments.job_id
      WHERE attachments.deleted_at IS NULL AND
      ((attachments.job_id IS NULL AND attachments.created_at<?) OR jobs.status='published') LIMIT 100`)
      .all(cutoff.toISOString());
  }
  schedule({ accountId, content, scheduledAt, attachmentId, id = crypto.randomUUID() }) {
    if (typeof content !== 'string' || content.length > 3000 || (!content.trim()&&!attachmentId)) throw new Error('Post content required');
    if (!Number.isFinite(Date.parse(scheduledAt))) throw new Error('Invalid scheduled date');
    if (!this.getAccount(accountId)) throw new Error('Unknown account');
    scheduledAt = new Date(scheduledAt).toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(attachmentId) {
        const file=this.getAttachment(attachmentId);
        if(!file||file.account_id!==accountId||file.job_id||file.deleted_at)throw Error('Invalid attachment');
      }
      this.db.prepare(`INSERT INTO jobs(id,account_id,content,scheduled_at,next_attempt,status)
        VALUES(?,?,?,?,?,'scheduled')`).run(id, accountId, content, scheduledAt, scheduledAt);
      if(attachmentId) this.db.prepare('UPDATE attachments SET job_id=? WHERE id=?').run(id,attachmentId);
      this.db.exec('COMMIT');
      return id;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  scheduleBatch({accountIds,content,scheduledAt,attachmentIds={}}) {
    if(!Array.isArray(accountIds)||!accountIds.length||accountIds.length>50||new Set(accountIds).size!==accountIds.length)
      throw Error('Select valid profiles');
    if(typeof content!=='string'||content.length>3000||(!content.trim()&&!accountIds.every(id=>attachmentIds[id])))
      throw Error('Post content required');
    if(!Number.isFinite(Date.parse(scheduledAt))||Date.parse(scheduledAt)<=Date.now())
      throw Error('Choose a future date and time');
    const time=new Date(scheduledAt).toISOString();
    const ids=[];
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const accountId of accountIds){
        const account=this.getAccount(accountId);
        if(!account||Date.parse(account.expires_at)<=Date.now())throw Error('Reconnect selected profile');
        const attachmentId=attachmentIds[accountId];
        if(attachmentId){
          const file=this.getAttachment(attachmentId);
          if(!file||file.account_id!==accountId||file.job_id||file.deleted_at)throw Error('Invalid attachment');
        }
        const id=crypto.randomUUID();
        this.db.prepare(`INSERT INTO jobs(id,account_id,content,scheduled_at,next_attempt,status)
          VALUES(?,?,?,?,?,'scheduled')`).run(id,accountId,content,time,time);
        if(attachmentId)this.db.prepare('UPDATE attachments SET job_id=? WHERE id=?').run(id,attachmentId);
        ids.push(id);
      }
      this.db.exec('COMMIT');return ids;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  listJobs() {
    return this.db.prepare(`SELECT jobs.id,jobs.account_id,jobs.content,jobs.scheduled_at,jobs.status,jobs.attempts,jobs.last_error,jobs.remote_post_id,
      attachments.filename AS attachment_name FROM jobs LEFT JOIN attachments ON attachments.job_id=jobs.id
      ORDER BY scheduled_at`).all();
  }
  async claimDue(now) {
    const timestamp = now.toISOString();
    const lease = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    this.db.prepare("UPDATE jobs SET status='uncertain',last_error='Interrupted publication; check LinkedIn before scheduling again',lease_until=NULL WHERE status='publishing' AND lease_until<=?").run(timestamp);
    // SQLite serializes the UPDATE and RETURNING as one atomic operation.
    return this.db.prepare(`UPDATE jobs SET status='publishing',attempts=attempts+1,lease_until=?
      WHERE id = (SELECT id FROM jobs WHERE
        (status='scheduled' AND next_attempt<=?)
        ORDER BY next_attempt,id LIMIT 1)
      RETURNING id,account_id,content,attempts-1 AS attempts`).get(lease, timestamp) ?? null;
  }
  async markPublished(id, postId) {
    this.db.prepare(`UPDATE jobs SET status='published',remote_post_id=?,lease_until=NULL WHERE id=? AND status='publishing'`).run(postId,id);
  }
  async markRetry(id, nextAttempt, message) {
    this.db.prepare(`UPDATE jobs SET status='scheduled',next_attempt=?,last_error=?,lease_until=NULL WHERE id=? AND status='publishing'`)
      .run(nextAttempt.toISOString(),message,id);
  }
  markAccountExpired(id) { this.db.prepare('UPDATE accounts SET expires_at=? WHERE id=?').run(new Date(0).toISOString(),id); }
  async markUncertain(id) { this.db.prepare("UPDATE jobs SET status='uncertain',last_error='Publication outcome unknown; check LinkedIn before scheduling again',lease_until=NULL WHERE id=? AND status='publishing'").run(id); }
  async markFailed(id, message) {
    this.db.prepare(`UPDATE jobs SET status='failed',last_error=?,lease_until=NULL WHERE id=? AND status='publishing'`).run(message,id);
  }
}
