import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { WebSocket } from 'ws';

// Run the real driver and transactions against an isolated MongoDB replica set.
const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
const {closeDatabase, database, reserveUpload}=await import('../cloud/store.mjs');
const observer=new MongoClient(replica.getUri('other-existing-db'));
await observer.connect();
await observer.db('other-existing-db').collection('sentinel').insertOne({_id:'keep',value:'untouched'});
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
  delete process.env.MONGODB_URI;
  assert.equal((await api('health')).status,503);
  process.env.MONGODB_URI=replica.getUri('other-existing-db');
  assert.equal((await api('health')).status,200);
  assert.equal((await api('health')).database,'go-celiac-db');
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
  // Concurrent requests cannot create duplicate questions/answers or exceed photo limits.
  const next=randomUUID();
  await Promise.all(Array.from({length:4},()=>api('questions',a,{id:next,text:'retry concurrently',images:[]})));
  assert.equal(await (await database()).collection('questions').countDocuments({_id:next}),1);
  const replies=await Promise.all(Array.from({length:4},()=>api('answers',c,{id:randomUUID(),questionId:next,choice:'לא מכיר',text:''})));
  assert.ok(replies.every(reply=>reply.status===201));
  assert.equal(new Set(replies.map(reply=>reply.id)).size,1);
  const uploadQuestion=randomUUID();
  const reserved=await Promise.all(Array.from({length:8},()=>reserveUpload(`photos/${a}/${uploadQuestion}/${randomUUID()}.png`,a,uploadQuestion)));
  assert.equal(reserved.filter(Boolean).length,6);
  await closeDatabase();
  assert.equal((await api('state',a)).mine.length,2);
  assert.equal((await observer.db('other-existing-db').collection('sentinel').findOne({_id:'keep'})).value,'untouched');
  assert.deepEqual(await observer.db('other-existing-db').listCollections().toArray().then(rows=>rows.map(row=>row.name)),['sentinel']);
  console.log('MongoDB transactions, live delivery, retries, concurrent requests, upload limits, reconnect persistence and go-celiac-db isolation passed.');
} finally {
  for(const ws of sockets)ws.terminate();
  await new Promise(resolve=>server.close(resolve));
  await closeDatabase();await observer.close();await replica.stop();
}
