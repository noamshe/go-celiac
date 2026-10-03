import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { WebSocket } from 'ws';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import webpush from 'web-push';
import { randomBytes } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const deliveries=[];
const originalSend=webpush.sendNotification;
webpush.sendNotification=async(subscription,payload,options)=>{
  // Validate actual encryption/signing while replacing only outbound transport.
  webpush.generateRequestDetails(subscription,payload,options);
  deliveries.push({endpoint:subscription.endpoint,payload:JSON.parse(payload)});
  if(subscription.endpoint.endsWith('/expired'))throw Object.assign(new Error('Expired'),{statusCode:410});
  return {statusCode:201};
};

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
let browser;
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
  const key=await api('push-key');assert.deepEqual(Object.keys(key).sort(),['publicKey','status']);
  function subscription(label) {return {endpoint:`https://fcm.googleapis.com/fcm/send/${label}`,keys:{p256dh:webpush.generateVAPIDKeys().publicKey,auth:randomBytes(16).toString('base64url')}};}
  const sa=subscription('a'),sb=subscription('b'),sc=subscription('c');
  for(const [id,sub] of [[a,sa],[b,sb],[c,sc]])assert.equal((await api('push-subscribe',id,sub)).status,200);
  assert.equal((await api('push-subscribe',b,sb)).status,200);
  assert.equal((await api('push-subscribe',b,{...sb,endpoint:'https://127.0.0.1/private'})).status,400);
  assert.equal((await api('push-test',a,{})).sent,1);
  deliveries.length=0;
  const [ma,mb,mc]=await Promise.all([socket(a),socket(b),socket(c)]);
  const photoId=randomUUID();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==','base64');
  async function upload(user,imageId,questionId,data=png,type='image/png') {
    return fetch(`${base}/api/upload?id=${imageId}&questionId=${questionId}`,{method:'POST',headers:{'x-user-id':user,'content-type':type},body:data});
  }
  const firstUpload=await upload(a,photoId,q);assert.equal(firstUpload.status,201);
  const photoUrl=(await firstUpload.json()).url;
  assert.equal((await upload(a,photoId,q)).status,201);
  assert.equal((await upload(b,photoId,q)).status,400);
  assert.equal((await upload(a,randomUUID(),q,Buffer.from('<script>bad</script>'))).status,400);
  assert.equal((await upload(a,randomUUID(),q,Buffer.alloc(2*1024*1024+1))).status,413);
  assert.equal((await fetch(base+photoUrl)).status,404);
  assert.equal((await api('questions',b,{id:randomUUID(),text:'wrong owner',images:[photoUrl]})).status,400);
  assert.equal((await api('questions',a,{id:q,text:'האם מתאים?',images:[photoUrl]})).status,201);
  assert.deepEqual(deliveries.map(item=>item.endpoint).sort(),[sb.endpoint,sc.endpoint].sort());
  assert.ok(deliveries.every(item=>item.payload.url==='/#help'));
  await until(()=>mb.some(m=>m.type==='question') && mc.some(m=>m.type==='question'));
  assert.equal(ma.filter(m=>m.type==='question').length,0);
  assert.equal((await api('state',a)).questions.length,0);
  assert.equal((await api('state',b)).questions.length,1);
  assert.deepEqual((await api('state',b)).questions[0].images,[photoUrl]);
  const served=await fetch(base+photoUrl);assert.equal(served.status,200);
  assert.equal(served.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()),png);
  assert.equal((await api('questions',a,{id:q,text:'retry',images:[]})).status,200);
  assert.equal(deliveries.length,2);
  assert.equal((await api('questions',b,{id:q,text:'other',images:[]})).status,409);
  assert.equal((await api('answers',b,{id:answer,questionId:q,choice:'לא מכיר',text:'תשובה'})).status,201);
  assert.equal(deliveries.at(-1).endpoint,sa.endpoint);
  assert.equal(deliveries.at(-1).payload.url,'/#inbox');
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
  assert.equal((await api('push-key')).publicKey,key.publicKey);
  const expired=subscription('expired');await api('push-subscribe',a,expired);
  assert.equal((await api('push-test',a,{})).sent,1);
  assert.equal(await (await database()).collection('push_subscriptions').countDocuments({_id:expired.endpoint}),0);
  assert.equal((await api('state',a)).mine.length,2);
  assert.deepEqual(Buffer.from(await (await fetch(base+photoUrl)).arrayBuffer()),png);
  assert.equal((await observer.db('other-existing-db').collection('sentinel').findOne({_id:'keep'})).value,'untouched');
  assert.deepEqual(await observer.db('other-existing-db').listCollections().toArray().then(rows=>rows.map(row=>row.name)),['sentinel']);
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();
  const moduleUrl=`data:text/javascript;base64,${Buffer.from(await readFile(new URL('../src/photo-upload.js',import.meta.url))).toString('base64')}`;
  const compression=await page.evaluate(async url=>{
    const {preparePhoto}=await import(url);
    const canvas=document.createElement('canvas');canvas.width=1500;canvas.height=1500;
    const context=canvas.getContext('2d');const pixels=context.createImageData(1500,1500);
    let seed=1234;for(let i=0;i<pixels.data.length;i++){seed=(seed*1664525+1013904223)>>>0;pixels.data[i]=i%4===3?255:seed>>>24;}
    context.putImageData(pixels,0,0);
    const input=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const output=await preparePhoto(input);
    const decoded=await createImageBitmap(output);
    const small=new Blob([new Uint8Array(20)],{type:'image/png'});
    let rejected=false;try{await preparePhoto(new Blob(['bad'],{type:'text/html'}));}catch{rejected=true;}
    return {before:input.size,after:output.size,type:output.type,width:decoded.width,smallUnchanged:await preparePhoto(small)===small,rejected};
  },moduleUrl);
  assert.ok(compression.before>2*1024*1024);
  assert.ok(compression.after<=2*1024*1024);
  assert.equal(compression.type,'image/jpeg');assert.ok(compression.width>0);
  assert.ok(compression.smallUnchanged && compression.rejected);
  const listeners={},shown=[];
  let opened;
  runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),{URL,self:{addEventListener:(name,handler)=>{listeners[name]=handler;},location:{origin:'https://go-celiac.vercel.app'},registration:{showNotification:async(title,options)=>shown.push({title,options})},clients:{matchAll:async()=>[],openWindow:async url=>{opened=url;}}}});
  let task;
  listeners.push({data:{json:()=>({title:'תשובה',body:'תשובה חדשה',url:'/#inbox'})},waitUntil:promise=>{task=promise;}});await task;
  assert.equal(shown[0].options.data.url,'/#inbox');
  listeners.notificationclick({notification:{close:()=>{},data:shown[0].options.data},waitUntil:promise=>{task=promise;}});await task;
  assert.equal(opened,'https://go-celiac.vercel.app/#inbox');
  console.log('MongoDB transactions, live delivery, retries, concurrent requests, upload limits, reconnect persistence and go-celiac-db isolation passed.');
  console.log('Browser image compression and small-image preservation passed.');
  console.log('Push encryption/signing, subscriptions, sender exclusion, reply routing, test send, key persistence, expired cleanup and notification click routing passed (transport mocked).');
} finally {
  for(const ws of sockets)ws.terminate();
  await new Promise(resolve=>server.close(resolve));
  await closeDatabase();await observer.close();await replica.stop();
  if(browser)await browser.close();
  webpush.sendNotification=originalSend;
}
