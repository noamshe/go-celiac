import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { pushKeys, subscribe, deliverPush, notifyQuestion, notifyAnswer } from './push.mjs';
import { configured, database, DATABASE_NAME, snapshot, exists, saveProfile, question, ownsUpload, saveImage, image as storedImage, saveQuestion, saveAnswer, markRead, latestEvent, eventsAfter } from './store.mjs';

const choices=['אני/הילד שלי צורך אותו','ביררתי מול היצרן/יבואן','כתוב על האריזה / יש סימון','ידוע לי שלא מתאים','יש לי מידע נוסף','לא מכיר'];
const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function text(value,max){if(typeof value!=='string' || value.trim().length>max)fail('טקסט לא תקין.');return value.trim();}
function send(res,data,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)fail('בקשה גדולה מדי. העלה את התמונות ישירות לאחסון.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail('בקשה לא תקינה.');}}
function route(req){const url=new URL(req.url,'https://localhost');return {url,name:url.searchParams.get('route') || url.pathname.replace(/^\/api\//,'').replace(/^\//,'')};}
function originAllowed(req){return !req.headers.origin || ['http:','https:'].some(protocol=>req.headers.origin===`${protocol}//${req.headers.host}`);}
async function imageBody(req) {
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)fail('תמונה גדולה מדי. נסה תמונה קטנה יותר.',413);chunks.push(chunk);}
  const data=Buffer.concat(chunks);
  const type=req.headers['content-type'];
  const signatures={
    'image/jpeg':()=>data[0]===255 && data[1]===216 && data[2]===255,
    'image/png':()=>data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    'image/webp':()=>data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WEBP',
    'image/gif':()=>['GIF87a','GIF89a'].includes(data.toString('ascii',0,6)),
  };
  if(!signatures[type]?.())fail('קובץ תמונה לא תקין.');
  return {data,contentType:type};
}

export const server=createServer(async(req,res)=>{
  try {
    const {name,url}=route(req);
    if(!originAllowed(req))fail('מקור בקשה לא מורשה.',403);
    if(name==='health') {
      if(!configured())return send(res,{ok:false,missing:['MONGODB_URI'],error:'יש לחבר MongoDB Atlas לפרויקט.'},503);
      await (await database()).command({ping:1});
      return send(res,{ok:true,uploads:true,storage:'mongodb',database:DATABASE_NAME});
    }
    if(name==='config' && req.method==='GET')return send(res,{uploads:'mongodb',configured:configured()});
    if(name==='push-key' && req.method==='GET')return send(res,{publicKey:(await pushKeys()).publicKey});
    if(name==='image' && req.method==='GET') {
      const imageId=url.searchParams.get('id');if(!uuid(imageId))fail('תמונה לא נמצאה.',404);
      const photo=await storedImage(imageId);if(!photo)fail('תמונה לא נמצאה.',404);
      res.writeHead(200,{'content-type':photo.contentType,'content-length':photo.data.length,'cache-control':'public, max-age=31536000, immutable','x-content-type-options':'nosniff'});
      return res.end(photo.data);
    }
    if(name==='profile' && req.method==='POST') {
      const input=await body(req);if(!uuid(input.id))fail('מזהה משתמש לא תקין.');
      const name=text(input.name,40);if(!name)fail('נדרש שם.');
      await saveProfile(input.id,name);
      void flush();return send(res,{ok:true});
    }
    const id=req.headers['x-user-id'];
    if(!uuid(id) || !(await exists(id)))fail('נדרש פרופיל משתמש.',401);
    if(name==='push-subscribe' && req.method==='POST') {
      await subscribe(id,await body(req));return send(res,{ok:true});
    }
    if(name==='push-test' && req.method==='POST') {
      const result=await deliverPush({userId:id},{title:'ביחד · התראת ניסיון',body:'ההתראות פועלות! לחץ כדי לפתוח את השאלות בקהילה.',url:'/#help',tag:'push-test'});
      if(!result.sent)fail(result.failed?'שליחת ההתראה נכשלה. נסה להפעיל התראות מחדש.':'אפשר התראות במכשיר הזה לפני הניסיון.',503);
      return send(res,{ok:true,sent:result.sent});
    }
    if(name==='upload' && req.method==='POST') {
      const imageId=url.searchParams.get('id'),questionId=url.searchParams.get('questionId');
      if(!uuid(imageId) || !uuid(questionId))fail('בקשת העלאה לא תקינה.');
      const published=await question(questionId);
      if(published)fail('השאלה כבר נשלחה.',409);
      const photo=await imageBody(req);
      if(!await saveImage(imageId,id,questionId,photo.data,photo.contentType))fail('עד 6 תמונות לשאלה.');
      return send(res,{url:`/api/image?id=${imageId}`},201);
    }
    if(name==='state' && req.method==='GET')return send(res,await snapshot(id));
    if(name==='questions' && req.method==='POST') {
      const input=await body(req);
      if(!uuid(input.id))fail('מזהה שאלה לא תקין.');
      const existing=await question(input.id);
      if(existing){if(existing.senderId!==id)fail('מזהה שאלה כבר קיים.',409);return send(res,{id:input.id});}
      const questionText=text(input.text || '',2000);
      if(!Array.isArray(input.images) || input.images.length>6 || (!questionText && !input.images.length))fail('הוסף שאלה או עד 6 תמונות.');
      const images=[];
      for(const image of input.images) {
        if(typeof image!=='string' || !/^\/api\/image\?id=[0-9a-f-]{36}$/i.test(image))fail('כתובת תמונה לא תקינה.');
        const imageId=new URL(image,'https://localhost').searchParams.get('id');
        if(!uuid(imageId) || !await ownsUpload(imageId,id,input.id))fail('תמונה לא תקינה לשאלה.');
        images.push(image);
      }
      const saved=await saveQuestion({id:input.id,senderId:id,text:questionText,images,createdAt:Date.now()});
      if(!saved.owned)fail('מזהה שאלה כבר קיים.',409);
      void flush();
      if(saved.created)await notifyQuestion(id,input.id).catch(error=>console.error('Push dispatch failed:',error.name));
      return send(res,{id:input.id},201);
    }
    if(name==='answers' && req.method==='POST') {
      const input=await body(req);if(!uuid(input.id) || !uuid(input.questionId) || !choices.includes(input.choice))fail('תשובה לא תקינה.');
      const answerText=text(input.text || '',2000);
      const target=await question(input.questionId);
      if(!target)fail('השאלה לא נמצאה.',404);if(target.senderId===id)fail('לא ניתן לענות לשאלה של עצמך.');
      const saved=await saveAnswer({id:input.id,questionId:input.questionId,senderId:id,recipientId:target.senderId,choice:input.choice,text:answerText,createdAt:Date.now()});
      void flush();
      if(saved.created)await notifyAnswer(target.senderId,input.questionId).catch(error=>console.error('Push dispatch failed:',error.name));
      return send(res,{id:saved.id},201);
    }
    if(name==='read' && req.method==='POST') {
      const input=await body(req);if(!Array.isArray(input.ids) || input.ids.length>1000 || !input.ids.every(uuid))fail('מזהים לא תקינים.');
      await markRead(input.ids,id);
      void flush();return send(res,{ok:true});
    }
    fail('לא נמצא.',404);
  }catch(error){console.error('Community request failed:',error.status || error.code || error.name);if(!res.headersSent)send(res,{error:error.status?error.message:'שירות הקהילה לא זמין כרגע. בדוק את הגדרות מסד הנתונים בפריסה.'},error.status || 503);}
});
const wss=new WebSocketServer({noServer:true,maxPayload:4096});
server.on('upgrade',async(req,socket,head)=>{
  try {
    const {url,name}=route(req);const id=url.searchParams.get('id');
    if(name!=='live' || !originAllowed(req) || !uuid(id) || !(await exists(id)))throw new Error('Unauthorized');
    const cursor=await latestEvent();
    wss.handleUpgrade(req,socket,head,ws=>{ws.userId=id;ws.cursor=cursor;wss.emit('connection',ws);});
  }catch{socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');socket.destroy();}
});
let timer;
wss.on('connection',async socket=>{
  socket.on('error',()=>{});
  try{socket.send(JSON.stringify(await snapshot(socket.userId)));}catch{socket.close(1011);}
  if(!timer)timer=setInterval(()=>void flush(),1500);
  socket.on('close',()=>{if(!wss.clients.size){clearInterval(timer);timer=null;}});
});
let flushing=false;
async function flush() {
  if(flushing || !wss.clients.size)return;
  flushing=true;
  try {
    const sockets=[...wss.clients].filter(ws=>ws.readyState===WebSocket.OPEN);
    if(!sockets.length)return;
    const min=Math.min(...sockets.map(ws=>ws.cursor));
    const events=await eventsAfter(min);
    if(!events.length)return;
    const states=new Map();
    for(const socket of sockets) {
      const updates=events.filter(event=>Number(event.id)>socket.cursor);
      if(!updates.length)continue;
      if(!states.has(socket.userId))states.set(socket.userId,await snapshot(socket.userId));
      if(socket.readyState!==WebSocket.OPEN)continue;
      socket.send(JSON.stringify(states.get(socket.userId)));
      for(const {payload} of updates) {
        if((payload.type==='question' && payload.senderId!==socket.userId) || (payload.type==='answer' && payload.recipientId===socket.userId))socket.send(JSON.stringify(payload));
      }
      socket.cursor=Number(updates.at(-1).id);
    }
  }catch{for(const socket of wss.clients)socket.close(1011,'Reconnect to reload community state');}
  finally{flushing=false;}
}
export default server;
