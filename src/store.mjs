import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import {defaultPreferences,validatePreferences,resolveDay,resolveProfileRows} from '../public/posting-times.js';

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
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS job_media (
        job_id TEXT NOT NULL REFERENCES jobs(id),
        attachment_id TEXT NOT NULL UNIQUE REFERENCES attachments(id),
        position INTEGER NOT NULL,
        PRIMARY KEY (job_id,position)
      );
    `);
  }
  postingPreferences(){
    const value=this.db.prepare("SELECT value FROM settings WHERE key='posting_preferences'").get()?.value;
    return value?validatePreferences(JSON.parse(value)):defaultPreferences();
  }
  savePostingPreferences(input){
    const value=validatePreferences(input),ids=new Set(this.listAccounts().map(a=>a.id));
    if([...Object.keys(value.profiles),...Object.keys(value.profileZones)].some(id=>!ids.has(id)))
      throw Error('Unknown profile');
    this.db.prepare("INSERT INTO settings(key,value) VALUES('posting_preferences',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(value));
    return value;
  }
  scheduleProfileRows({rows,content,attachmentIds={}}){
    const plan=resolveProfileRows(this.postingPreferences(),rows);
    return {ids:this.scheduleBatch({content,attachmentIds,...plan,scheduledAt:Object.values(plan.scheduledTimes)[0]}),skipped:plan.skipped};
  }
  scheduleDay(input){
    const plan=resolveDay(this.postingPreferences(),input.accountIds,input.day);
    return {ids:this.scheduleBatch({...input,...plan,scheduledAt:Object.values(plan.scheduledTimes)[0]}),skipped:plan.skipped};
  }
  moveJob({id,day}){
    const job=this.db.prepare("SELECT account_id FROM jobs WHERE id=? AND status='scheduled'").get(id);
    if(!job)throw Error('Post unavailable or already publishing');
    const plan=resolveDay(this.postingPreferences(),[job.account_id],day);
    const time=plan.scheduledTimes[job.account_id];
    const row=this.db.prepare("UPDATE jobs SET scheduled_at=?,next_attempt=?,attempts=0,last_error=NULL WHERE id=? AND status='scheduled' RETURNING id,scheduled_at")
      .get(time,time,id);
    if(!row)throw Error('Post unavailable or already publishing');
    return row;
  }
  changeJobState(id,action){
    if(!['draft','delete'].includes(action))throw Error('Invalid action');
    const allowed=action==='draft'?"'scheduled','failed','uncertain'":"'scheduled','draft','failed','uncertain','published'";
    const row=this.db.prepare("UPDATE jobs SET status=?,lease_until=NULL WHERE id=? AND status IN ("+allowed+") RETURNING id,status")
      .get(action==='draft'?'draft':'deleted',id);
    if(!row)throw Error('Post unavailable or already publishing');
    return row;
  }
  updateDraft({id,content,scheduledAt,schedule=false,attachmentId},expectedStatus='draft'){
    if(!['draft','scheduled'].includes(expectedStatus))throw Error('Post unavailable');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const job=this.db.prepare('SELECT * FROM jobs WHERE id=? AND status=?').get(id,expectedStatus);
      if(!job)throw Error(expectedStatus==='scheduled'?'Post unavailable or already publishing':'Draft unavailable');
      if(typeof content!=='string'||content.length>3000)throw Error('Invalid post');
      const existing=this.attachmentsForJob(id);
      const replacing=attachmentId!==undefined;
      const media=replacing?this.validateAttachments(attachmentId,job.account_id):[];
      if(!content.trim()&&!(replacing?media.length:existing.length))throw Error('Post content required');
      if(schedule){
        if(!Number.isFinite(Date.parse(scheduledAt))||Date.parse(scheduledAt)<=Date.now())throw Error('Choose a future date and time');
        const account=this.getAccount(job.account_id);
        if(!account||Date.parse(account.expires_at)<=Date.now())throw Error('Reconnect selected profile');
      }
      if(replacing){
        const now=new Date().toISOString();
        this.db.prepare('UPDATE attachments SET job_id=NULL,created_at=? WHERE job_id=?').run(now,id);
        this.db.prepare('UPDATE attachments SET created_at=? WHERE id IN (SELECT attachment_id FROM job_media WHERE job_id=?)').run(now,id);
        this.db.prepare('DELETE FROM job_media WHERE job_id=?').run(id);
        for(const [position,attachmentId] of media.entries())
          this.db.prepare('INSERT INTO job_media(job_id,attachment_id,position) VALUES(?,?,?)').run(id,attachmentId,position);
      }
      const time=schedule?new Date(scheduledAt).toISOString():job.scheduled_at;
      const row=this.db.prepare("UPDATE jobs SET content=?,scheduled_at=?,next_attempt=?,status=?,attempts=0,last_error=NULL,remote_post_id=NULL,lease_until=NULL WHERE id=? AND status=? RETURNING id,status")
        .get(content,time,time,schedule?'scheduled':'draft',id,expectedStatus);
      if(!row)throw Error('Post unavailable or already publishing');
      this.db.exec('COMMIT');
      return row;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
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
  attachmentsForJob(jobId){
    return this.db.prepare('SELECT a.*,m.position AS media_position FROM attachments a JOIN job_media m ON m.attachment_id=a.id WHERE m.job_id=? UNION ALL SELECT a.*,0 AS media_position FROM attachments a WHERE a.job_id=? ORDER BY media_position')
      .all(jobId,jobId);
  }
  attachmentForJob(jobId){return this.attachmentsForJob(jobId)[0]??null;}
  validateAttachments(value,accountId){
    const ids=value===undefined?[]:Array.isArray(value)?value:[value];
    if(ids.length>20||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id))
      throw Error('Select 1–20 images or one document/video');
    const files=[];
    for(const id of ids){
      const file=this.getAttachment(id);
      const used=this.db.prepare('SELECT attachment_id FROM job_media WHERE attachment_id=?').get(id);
      if(!file||file.account_id!==accountId||file.job_id||file.deleted_at||used)throw Error('Invalid attachment');
      files.push(file);
    }
    if(files.length>1&&files.some(f=>f.kind!=='image'))throw Error('Multiple attachments must all be images');
    return ids;
  }
  markAttachmentDeleted(id) {
    this.db.prepare('UPDATE attachments SET deleted_at=? WHERE id=?').run(new Date().toISOString(),id);
  }
  mediaForCleanup(cutoff){
    return this.db.prepare("SELECT a.id FROM attachments a LEFT JOIN job_media m ON m.attachment_id=a.id LEFT JOIN jobs j ON j.id=COALESCE(a.job_id,m.job_id) WHERE a.deleted_at IS NULL AND ((a.job_id IS NULL AND m.job_id IS NULL AND a.created_at<?) OR j.status IN ('published','deleted')) LIMIT 100")
      .all(cutoff.toISOString());
  }
  schedule({accountId,content,scheduledAt,attachmentId,id=crypto.randomUUID()}){
    if(typeof content!=='string'||content.length>3000)throw Error('Invalid post content');
    if(!Number.isFinite(Date.parse(scheduledAt)))throw Error('Invalid scheduled date');
    if(!this.getAccount(accountId))throw Error('Unknown account');
    const media=this.validateAttachments(attachmentId,accountId);
    if(!content.trim()&&!media.length)throw Error('Post content required');
    const time=new Date(scheduledAt).toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare("INSERT INTO jobs(id,account_id,content,scheduled_at,next_attempt,status) VALUES(?,?,?,?,?,'scheduled')")
        .run(id,accountId,content,time,time);
      for(const [position,fileId] of media.entries())
        this.db.prepare('INSERT INTO job_media(job_id,attachment_id,position) VALUES(?,?,?)')
          .run(id,fileId,position);
      this.db.exec('COMMIT');return id;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  scheduleBatch({accountIds,content,scheduledAt,attachmentIds={},scheduledTimes={}}){
    if(!Array.isArray(accountIds)||!accountIds.length||accountIds.length>50||new Set(accountIds).size!==accountIds.length)
      throw Error('Select valid profiles');
    if(typeof content!=='string'||content.length>3000||(!content.trim()&&!accountIds.every(id=>Array.isArray(attachmentIds[id])?attachmentIds[id].length:attachmentIds[id])))
      throw Error('Post content required');
    if(!Number.isFinite(Date.parse(scheduledAt))||Date.parse(scheduledAt)<=Date.now())
      throw Error('Choose a future date and time');
    for(const id of accountIds)
      if(!Number.isFinite(Date.parse(scheduledTimes[id]||scheduledAt))||Date.parse(scheduledTimes[id]||scheduledAt)<=Date.now())
        throw Error('Choose a future date and time');
    const ids=[];
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const accountId of accountIds){
        const time=new Date(scheduledTimes[accountId]||scheduledAt).toISOString();
        const account=this.getAccount(accountId);
        if(!account||Date.parse(account.expires_at)<=Date.now())throw Error('Reconnect selected profile');
        const media=this.validateAttachments(attachmentIds[accountId],accountId);
        const id=crypto.randomUUID();
        this.db.prepare("INSERT INTO jobs(id,account_id,content,scheduled_at,next_attempt,status) VALUES(?,?,?,?,?,'scheduled')")
          .run(id,accountId,content,time,time);
        for(const [position,fileId] of media.entries())
          this.db.prepare('INSERT INTO job_media(job_id,attachment_id,position) VALUES(?,?,?)')
            .run(id,fileId,position);
        ids.push(id);
      }
      this.db.exec('COMMIT');return ids;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  listJobs(){
    return this.db.prepare("SELECT j.id,j.account_id,j.content,j.scheduled_at,j.status,j.attempts,j.last_error,j.remote_post_id, (SELECT group_concat(filename, ' | ') FROM (SELECT a.filename FROM attachments a LEFT JOIN job_media m ON m.attachment_id=a.id WHERE a.job_id=j.id OR m.job_id=j.id ORDER BY COALESCE(m.position,0))) AS attachment_name FROM jobs j WHERE j.status<>'deleted' ORDER BY j.scheduled_at")
      .all();
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
