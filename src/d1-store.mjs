// D1 adapter for the same durable queue contract used by the local SQLite app.
export class D1Store {
  constructor(db) {
    if (!db?.prepare) throw Error('D1 binding DB required');
    this.db = db;
  }
  async loginBlocked(ip) {
    const row=await this.db.prepare('SELECT attempts,reset_at FROM login_attempts WHERE ip_hash=?').bind(await digest(ip)).first();
    return Boolean(row&&row.attempts>=10&&row.reset_at>new Date().toISOString());
  }
  async recordLoginFailure(ip) {
    const hash=await digest(ip),reset=new Date(Date.now()+900000).toISOString();
    await this.db.prepare(`INSERT INTO login_attempts(ip_hash,attempts,reset_at) VALUES(?,1,?)
      ON CONFLICT(ip_hash) DO UPDATE SET
      attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,
      reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END`)
      .bind(hash,reset,new Date().toISOString(),new Date().toISOString()).run();
  }
  async clearLoginFailures(ip) {
    await this.db.prepare('DELETE FROM login_attempts WHERE ip_hash=?').bind(await digest(ip)).run();
  }
  async createSession(token, csrf, expiresAt) {
    const now = new Date().toISOString();
    await this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now).run();
    const row = await this.db.prepare('SELECT COUNT(*) AS count FROM sessions').first();
    if (row.count >= 1000) throw Error('Session limit');
    await this.db.prepare('INSERT INTO sessions(session_hash,csrf,expires_at) VALUES(?,?,?)')
      .bind(await digest(token),csrf,expiresAt).run();
  }
  async getSession(token, now=new Date()) {
    if (!token) return null;
    return await this.db.prepare('SELECT csrf,expires_at FROM sessions WHERE session_hash=? AND expires_at>?')
      .bind(await digest(token),now.toISOString()).first();
  }
  async revokeSession(token) {
    if(token) await this.db.prepare('DELETE FROM sessions WHERE session_hash=?').bind(await digest(token)).run();
  }
  async setSessionOAuth(token,state,expiresAt) {
    const result=await this.db.prepare('UPDATE sessions SET oauth_state=?,oauth_expires_at=? WHERE session_hash=? AND expires_at>?')
      .bind(state,expiresAt,await digest(token),new Date().toISOString()).run();
    if(!result.meta?.changes) throw Error('Session expired');
  }
  async consumeSessionOAuth(token,state,now=new Date()) {
    if(!token || !state) return false;
    const result=await this.db.prepare('UPDATE sessions SET oauth_state=NULL,oauth_expires_at=NULL WHERE session_hash=? AND oauth_state=? AND oauth_expires_at>? AND expires_at>? RETURNING csrf')
      .bind(await digest(token),state,now.toISOString(),now.toISOString()).first();
    return Boolean(result);
  }
  async upsertAccount({id,provider='linkedin',displayName,personUrn,encryptedToken,expiresAt}) {
    if(provider!=='linkedin' || personUrn!=='urn:li:person:'+id) throw Error('Account identity mismatch');
    await this.db.prepare(`INSERT INTO accounts(id,provider,display_name,person_urn,encrypted_token,expires_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      display_name=excluded.display_name,person_urn=excluded.person_urn,
      encrypted_token=excluded.encrypted_token,expires_at=excluded.expires_at`)
      .bind(id,provider,displayName,personUrn,encryptedToken,expiresAt).run();
  }
  async getAccount(id) {
    return await this.db.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first();
  }
  async listAccounts() {
    const r=await this.db.prepare('SELECT id,provider,display_name,person_urn,expires_at FROM accounts').all();
    return r.results ?? [];
  }
  async saveAttachment({id,accountId,filename,mime,kind,size}) {
    if(!await this.getAccount(accountId))throw Error('Unknown account');
    await this.db.prepare('INSERT INTO attachments(id,account_id,filename,mime,kind,size,created_at) VALUES(?,?,?,?,?,?,?)')
      .bind(id,accountId,filename,mime,kind,size,new Date().toISOString()).run();
  }
  async getAttachment(id) {
    if(!id)return null;
    return this.db.prepare('SELECT * FROM attachments WHERE id=?').bind(id).first();
  }
  async attachmentForJob(jobId) {
    return this.db.prepare('SELECT * FROM attachments WHERE job_id=?').bind(jobId).first();
  }
  async markAttachmentDeleted(id) {
    await this.db.prepare('UPDATE attachments SET deleted_at=? WHERE id=?').bind(new Date().toISOString(),id).run();
  }
  async mediaForCleanup(cutoff) {
    const result=await this.db.prepare(`SELECT attachments.id FROM attachments
      LEFT JOIN jobs ON jobs.id=attachments.job_id
      WHERE attachments.deleted_at IS NULL AND
      ((attachments.job_id IS NULL AND attachments.created_at<?) OR jobs.status='published') LIMIT 100`)
      .bind(cutoff.toISOString()).all();
    return result.results??[];
  }
  async schedule({accountId,content,scheduledAt,attachmentId,id=crypto.randomUUID()}) {
    if(typeof content!=='string'||content.length>3000||(!content.trim()&&!attachmentId))throw Error('Post content required');
    if(!Number.isFinite(Date.parse(scheduledAt)))throw Error('Invalid date');
    if(!await this.getAccount(accountId))throw Error('Unknown account');
    const time=new Date(scheduledAt).toISOString();
    if(attachmentId){
      const file=await this.getAttachment(attachmentId);
      if(!file||file.account_id!==accountId||file.job_id||file.deleted_at)throw Error('Invalid attachment');
      if(!this.db.batch)throw Error('Atomic database batch required');
      const insert=this.db.prepare(`INSERT INTO jobs(id,account_id,content,scheduled_at,next_attempt,status)
        SELECT ?,?,?,?,?,'scheduled' WHERE EXISTS
        (SELECT 1 FROM attachments WHERE id=? AND account_id=? AND job_id IS NULL AND deleted_at IS NULL)`)
        .bind(id,accountId,content,time,time,attachmentId,accountId);
      const claim=this.db.prepare('UPDATE attachments SET job_id=? WHERE id=? AND account_id=? AND job_id IS NULL AND deleted_at IS NULL')
        .bind(id,attachmentId,accountId);
      const results=await this.db.batch([insert,claim]);
      if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)throw Error('Attachment already used');
    }else await this.db.prepare(`INSERT INTO jobs(id,account_id,content,scheduled_at,next_attempt,status)
      VALUES(?,?,?,?,?,'scheduled')`).bind(id,accountId,content,time,time).run();
    return id;
  }
  async scheduleBatch({accountIds,content,scheduledAt,attachmentIds={}}){
    if(!Array.isArray(accountIds)||!accountIds.length||accountIds.length>50||new Set(accountIds).size!==accountIds.length)
      throw Error('Select valid profiles');
    if(typeof content!=='string'||content.length>3000||(!content.trim()&&!accountIds.every(id=>attachmentIds[id])))
      throw Error('Post content required');
    if(!Number.isFinite(Date.parse(scheduledAt))||Date.parse(scheduledAt)<=Date.now())
      throw Error('Choose a future date and time');
    if(!this.db.batch)throw Error('Atomic batch required');
    const time=new Date(scheduledAt).toISOString(),queries=[],ids=[];
    for(const accountId of accountIds){
      const account=await this.getAccount(accountId);
      if(!account||Date.parse(account.expires_at)<=Date.now())throw Error('Reconnect selected profile');
      const attachmentId=attachmentIds[accountId];
      if(attachmentId){
        const file=await this.getAttachment(attachmentId);
        if(!file||file.account_id!==accountId||file.job_id||file.deleted_at)throw Error('Invalid attachment');
      }
      const id=crypto.randomUUID();ids.push(id);
      queries.push(this.db.prepare(`INSERT INTO jobs(id,account_id,content,scheduled_at,next_attempt,status)
        VALUES(?,?,?,?,?,'scheduled')`).bind(id,accountId,content,time,time));
      if(attachmentId)queries.push(this.db.prepare('UPDATE attachments SET job_id=? WHERE id=? AND account_id=? AND job_id IS NULL AND deleted_at IS NULL')
        .bind(id,attachmentId,accountId));
    }
    const result=await this.db.batch(queries);
    if(result.some(r=>r.meta?.changes!==1))throw Error('Attachment already used');
    return ids;
  }
  async listJobs() {
    const r=await this.db.prepare(`SELECT jobs.id,jobs.account_id,jobs.content,jobs.scheduled_at,jobs.status,jobs.attempts,jobs.last_error,jobs.remote_post_id,
      attachments.filename AS attachment_name FROM jobs LEFT JOIN attachments ON attachments.job_id=jobs.id
      ORDER BY jobs.scheduled_at`).all();
    return r.results ?? [];
  }
  async claimDue(now) {
    const timestamp=now.toISOString(),lease=new Date(now.getTime()+300000).toISOString();
    await this.db.prepare("UPDATE jobs SET status='uncertain',last_error='Interrupted publication; check LinkedIn before scheduling again',lease_until=NULL WHERE status='publishing' AND lease_until<=?")
      .bind(timestamp).run();
    return await this.db.prepare(`UPDATE jobs SET status='publishing',attempts=attempts+1,lease_until=?
      WHERE id=(SELECT id FROM jobs WHERE status='scheduled' AND next_attempt<=? ORDER BY next_attempt,id LIMIT 1)
      RETURNING id,account_id,content,attempts-1 AS attempts`).bind(lease,timestamp).first();
  }
  async markPublished(id,postId) {
    await this.db.prepare("UPDATE jobs SET status='published',remote_post_id=?,lease_until=NULL WHERE id=? AND status='publishing'")
      .bind(postId,id).run();
  }
  async markRetry(id,nextAttempt,message) {
    await this.db.prepare("UPDATE jobs SET status='scheduled',next_attempt=?,last_error=?,lease_until=NULL WHERE id=? AND status='publishing'")
      .bind(nextAttempt.toISOString(),message,id).run();
  }
  async markUncertain(id) {
    await this.db.prepare("UPDATE jobs SET status='uncertain',last_error='Publication outcome unknown; check LinkedIn before scheduling again',lease_until=NULL WHERE id=? AND status='publishing'")
      .bind(id).run();
  }
  async markFailed(id,message) {
    await this.db.prepare("UPDATE jobs SET status='failed',last_error=?,lease_until=NULL WHERE id=? AND status='publishing'")
      .bind(message,id).run();
  }
  async markAccountExpired(id) {
    await this.db.prepare('UPDATE accounts SET expires_at=? WHERE id=?')
      .bind(new Date(0).toISOString(),id).run();
  }
}
const encoder = new TextEncoder();
async function digest(value) {
  const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(value));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
