import test from 'node:test';
import assert from 'node:assert/strict';
import cron from '../infra/cron-worker.mjs';

test('cloud cron securely calls the scheduled publisher endpoint',async()=>{
  const original=globalThis.fetch;
  let calls=0;
  try{
    globalThis.fetch=async(url,init)=>{
      calls++;
      assert.equal(url,'https://example.test/internal/run-due');
      assert.equal(init.method,'POST');
      assert.equal(init.headers['x-scheduler-secret'],'test-secret');
      return new Response('{}',{status:200});
    };
    await cron.scheduled({},{
      SITE_TRIGGER_URL:'https://example.test/internal/run-due',
      SCHEDULER_TRIGGER_SECRET:'test-secret'
    });
    assert.equal(calls,1);
    await assert.rejects(cron.scheduled({},{
      SITE_TRIGGER_URL:'http://example.test/internal/run-due',
      SCHEDULER_TRIGGER_SECRET:'test-secret'
    }),/HTTPS/);
    await assert.rejects(cron.scheduled({},{}),/configuration missing/);
    globalThis.fetch=async()=>new Response('fail',{status:503});
    await assert.rejects(cron.scheduled({},{
      SITE_TRIGGER_URL:'https://example.test/internal/run-due',
      SCHEDULER_TRIGGER_SECRET:'test-secret'
    }),/HTTP 503/);
  }finally{globalThis.fetch=original;}
});
