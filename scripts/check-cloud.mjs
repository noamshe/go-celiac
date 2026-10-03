import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { WebSocket } from 'ws';

// Execute the production SQL against embedded Postgres without cloud credentials.
const db = new PGlite();
let queue = Promise.resolve();
let unlock;
function direct(sql, args) {
  return args ? db.query(sql,args).then(result=>({...result,rowCount:result.affectedRows ?? result.rows.length})) : db.exec(sql);
}
pg.Pool.prototype.query = function(sql,args) {
  const result=queue.then(()=>direct(sql,args));queue=result.catch(()=>{});return result;
};
pg.Pool.prototype.connect = async function() {
  const previous=queue;queue=new Promise(resolve=>{unlock=resolve;});const release=unlock;await previous;
  return {query:direct,release};
};
const {server}=await import('../cloud/community.mjs');
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const sockets=[];
async function api(route, user, data) {
  const response=await fetch(`${base}/api/${route}`,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(user?{'x-user-id':user}:{})},...(data?{body:JSON.stringify(data)}:{})});
  return {status:response.status,...await response.json()};
}
async function until(predicate) {
  const deadline=Date.now()+8000;
  while(!predicate()){if(Date.now()>deadline)throw new Error('Timed out waiting for live delivery');await new Promise(resolve=>setTimeout(resolve,30));}
}
async function socket(id) {
  const messages=[];const ws=new WebSocket(`${base.replace('http','ws')}/api/server?route=live&id=${id}`);
  sockets.push(ws);ws.on('message',data=>messages.push(JSON.parse(data)));
  await until(()=>messages.some(message=>message.type==='snapshot'));
  return messages;
}
try {
  delete process.env.DATABASE_URL;delete process.env.POSTGRES_URL;
  assert.equal((await api('health')).status,503);
  process.env.DATABASE_URL='postgres://embedded-test';
  assert.equal((await api('health')).status,200);
  const a=randomUUID(), b=randomUUID(), c=randomUUID(), q=randomUUID(), answer=randomUUID();
  for(const [id,name] of [[a,'א'],[b,'ב'],[c,'ג']])assert.equal((await api('profile',null,{id,name})).status,200);
  const [ma,mb,mc]=await Promise.all([socket(a),socket(b),socket(c)]);
  assert.equal((await api('questions',a,{id:q,text:'האם מתאים?',images:[]})).status,201);
  await until(()=>mb.some(m=>m.type==='question') && mc.some(m=>m.type==='question'));
  assert.equal(ma.filter(m=>m.type==='question').length,0);
  assert.equal((await api('state',a)).questions.length,0);
  assert.equal((await api('state',b)).questions.length,1);
  assert.equal((await api('questions',a,{id:q,text:'retry',images:[]})).status,200);
  assert.equal((await api('questions',b,{id:q,text:'other',images:[]})).status,409);
  assert.equal((await api('answers',b,{id:answer,questionId:q,choice:'לא מכיר',text:'תשובה'})).status,201);
  await until(()=>ma.some(m=>m.type==='answer'));
  assert.equal(mc.filter(m=>m.type==='answer').length,0);
  assert.equal((await api('state',a)).unread,1);
  assert.equal((await api('state',b)).questions[0].answered,true);
  await api('read',c,{ids:[answer]});assert.equal((await api('state',a)).unread,1);
  await api('read',a,{ids:[answer]});assert.equal((await api('state',a)).unread,0);
  assert.equal((await api('questions',a,{id:randomUUID(),text:'bad',images:['https://example.com/image.png']})).status,400);
  console.log('Vercel routes, real Postgres SQL, live delivery, identity exclusion, retries, answer routing and read ownership passed.');
} finally {
  for(const ws of sockets)ws.terminate();
  await new Promise(resolve=>server.close(resolve));
  await queue;await db.close();
}
