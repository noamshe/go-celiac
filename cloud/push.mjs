import webpush from 'web-push';
import { database } from './store.mjs';

export async function pushKeys() {
  const db=await database();
  let keys=await db.collection('settings').findOne({_id:'web-push'});
  if(!keys) {
    await db.collection('settings').updateOne({_id:'web-push'},{$setOnInsert:webpush.generateVAPIDKeys()},{upsert:true});
    keys=await db.collection('settings').findOne({_id:'web-push'});
  }
  return keys;
}
function validSubscription(value) {
  if(!value || typeof value.endpoint!=='string' || value.endpoint.length>4096)return false;
  let url;try{url=new URL(value.endpoint);}catch{return false;}
  const allowed=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'];
  if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || !allowed.some(host=>url.hostname===host || url.hostname.endsWith(`.${host}`)))return false;
  return typeof value.keys?.p256dh==='string' && /^[\w-]{87}$/.test(value.keys.p256dh) && typeof value.keys?.auth==='string' && /^[\w-]{22}$/.test(value.keys.auth);
}
export async function subscribe(userId,subscription) {
  if(!validSubscription(subscription))throw Object.assign(new Error('מינוי התראות לא תקין.'),{status:400});
  const normalized={endpoint:subscription.endpoint,keys:{p256dh:subscription.keys.p256dh,auth:subscription.keys.auth}};
  await (await database()).collection('push_subscriptions').updateOne({_id:normalized.endpoint},{$set:{userId,subscription:normalized,updatedAt:Date.now()}},{upsert:true});
}
export async function deliverPush(filter,payload) {
  const db=await database();
  const keys=await pushKeys();
  const subscriptions=await db.collection('push_subscriptions').find(filter).toArray();
  let sent=0,failed=0;
  for(let start=0;start<subscriptions.length;start+=8) {
    await Promise.all(subscriptions.slice(start,start+8).map(async record=>{
      try {
        await webpush.sendNotification(record.subscription,JSON.stringify(payload),{vapidDetails:{subject:'https://go-celiac.vercel.app',publicKey:keys.publicKey,privateKey:keys.privateKey},TTL:3600,timeout:8000,urgency:'normal'});
        sent++;
      } catch(error) {
        failed++;
        if([404,410].includes(error.statusCode))await db.collection('push_subscriptions').deleteOne({_id:record._id});
        console.error('Push delivery failed:',error.statusCode || error.code || error.name);
      }
    }));
  }
  return {sent,failed};
}
export async function notifyQuestion(senderId,questionId) {
  return deliverPush({userId:{$ne:senderId}},{title:'ביחד · שאלה חדשה בקהילה',body:'מישהו בקהילה צריך עזרה. רוצה לשתף במה שאתה יודע?',url:'/#help',tag:`question-${questionId}`});
}
export async function notifyAnswer(recipientId,questionId) {
  return deliverPush({userId:recipientId},{title:'ביחד · יש תשובה לשאלה שלך',body:'מישהו מהקהילה ענה לך. לחץ כדי לראות את התשובה.',url:'/#inbox',tag:`answer-${questionId}`});
}
