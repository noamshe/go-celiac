import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { handleUpload } from '@vercel/blob/client';
import { head } from '@vercel/blob';
import { configured, query, transaction, snapshot, exists } from './store.mjs';

const choices=['אני/הילד שלי צורך אותו','ביררתי מול היצרן/יבואן','כתוב על האריזה / יש סימון','ידוע לי שלא מתאים','יש לי מידע נוסף','לא מכיר'];
const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function text(value,max){if(typeof value!=='string' || value.trim().length>max)fail('טקסט לא תקין.');return value.trim();}
function send(res,data,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)fail('בקשה גדולה מדי. העלה את התמונות ישירות לאחסון.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail('בקשה לא תקינה.');}}
function route(req){const url=new URL(req.url,'https://localhost');return {url,name:url.searchParams.get('route') || url.pathname.replace(/^\/api\//,'').replace(/^\//,'')};}
function originAllowed(req){return !req.headers.origin || ['http:','https:'].some(protocol=>req.headers.origin===`${protocol}//${req.headers.host}`);}

export const server=createServer(async(req,res)=>{
  try {
    const {name}=route(req);
    if(!originAllowed(req))fail('מקור בקשה לא מורשה.',403);
    if(name==='health') {
      if(!configured())return send(res,{ok:false,missing:['DATABASE_URL'],error:'יש לחבר Postgres לפרויקט.'},503);
      await query('SELECT 1');
      return send(res,{ok:true,uploads:!!process.env.BLOB_READ_WRITE_TOKEN,storage:'postgres'});
    }
    if(name==='config' && req.method==='GET')return send(res,{uploads:'blob',configured:configured() && !!process.env.BLOB_READ_WRITE_TOKEN});
    if(name==='profile' && req.method==='POST') {
      const input=await body(req);if(!uuid(input.id))fail('מזהה משתמש לא תקין.');
      const name=text(input.name,40);if(!name)fail('נדרש שם.');
      await transaction(async db=>{
        await db.query('INSERT INTO community_users VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=excluded.name',[input.id,name]);
        await db.query('INSERT INTO community_events(payload) VALUES($1)',[JSON.stringify({type:'refresh'})]);
      });
      void flush();return send(res,{ok:true});
    }
    if(name==='upload' && req.method==='POST') {
      if(!process.env.BLOB_READ_WRITE_TOKEN)fail('חבר Blob store לפרויקט Vercel.',503);
      const input=await body(req);
      const result=await handleUpload({body:input,request:req,
        onBeforeGenerateToken:async(pathname,clientPayload)=>{
          let payload;try{payload=JSON.parse(clientPayload);}catch{fail('בקשת העלאה לא תקינה.');}
          const {userId,questionId}=payload;
          if(!uuid(userId) || !uuid(questionId) || !(await exists(userId)))fail('נדרש פרופיל משתמש.',401);
          const prefix=`photos/${userId}/${questionId}/`;
          if(!pathname.startsWith(prefix) || !/^[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif)$/.test(pathname.slice(prefix.length)))fail('נתיב תמונה לא תקין.');
          const count=(await query('SELECT COUNT(*)::int count FROM community_uploads WHERE "senderId"=$1 AND "questionId"=$2',[userId,questionId])).rows[0].count;
          const retry=(await query('SELECT path FROM community_uploads WHERE path=$1',[pathname])).rows[0];
          if(count>=6 && !retry)fail('עד 6 תמונות לשאלה.');
          await query('INSERT INTO community_uploads VALUES($1,$2,$3) ON CONFLICT(path) DO NOTHING',[pathname,userId,questionId]);
          return {allowedContentTypes:['image/jpeg','image/png','image/webp','image/gif'],maximumSizeInBytes:5*1024*1024,addRandomSuffix:false,tokenPayload:JSON.stringify(payload),callbackUrl:`${process.env.VERCEL?'https':'http'}://${req.headers.host}/api/upload`};
        },
        onUploadCompleted:async()=>{},
      });
      return send(res,result);
    }
    const id=req.headers['x-user-id'];
    if(!uuid(id) || !(await exists(id)))fail('נדרש פרופיל משתמש.',401);
    if(name==='state' && req.method==='GET')return send(res,await snapshot(id));
    if(name==='questions' && req.method==='POST') {
      const input=await body(req);
      if(!uuid(input.id))fail('מזהה שאלה לא תקין.');
      const existing=(await query('SELECT "senderId" FROM community_questions WHERE id=$1',[input.id])).rows[0];
      if(existing){if(existing.senderId!==id)fail('מזהה שאלה כבר קיים.',409);return send(res,{id:input.id});}
      const questionText=text(input.text || '',2000);
      if(!Array.isArray(input.images) || input.images.length>6 || (!questionText && !input.images.length))fail('הוסף שאלה או עד 6 תמונות.');
      const images=[];
      for(const image of input.images) {
        if(typeof image!=='string' || !/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(image))fail('כתובת תמונה לא תקינה.');
        const metadata=await head(image);
        const upload=(await query('SELECT path FROM community_uploads WHERE path=$1 AND "senderId"=$2 AND "questionId"=$3',[metadata.pathname,id,input.id])).rows[0];
        if(!upload || metadata.size>5*1024*1024 || !['image/jpeg','image/png','image/webp','image/gif'].includes(metadata.contentType))fail('תמונה לא תקינה לשאלה.');
        images.push(metadata.url);
      }
      await transaction(async db=>{
        const result=await db.query('INSERT INTO community_questions(id,"senderId",text,images,"createdAt") VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id',[input.id,id,questionText,JSON.stringify(images),Date.now()]);
        if(!result.rowCount && (await db.query('SELECT "senderId" FROM community_questions WHERE id=$1',[input.id])).rows[0]?.senderId!==id)fail('Question ID already exists.',409);
        if(result.rowCount)await db.query('INSERT INTO community_events(payload) VALUES($1)',[JSON.stringify({type:'question',senderId:id,questionId:input.id})]);
      });
      void flush();return send(res,{id:input.id},201);
    }
    if(name==='answers' && req.method==='POST') {
      const input=await body(req);if(!uuid(input.id) || !uuid(input.questionId) || !choices.includes(input.choice))fail('תשובה לא תקינה.');
      const answerText=text(input.text || '',2000);
      const question=(await query('SELECT "senderId" FROM community_questions WHERE id=$1',[input.questionId])).rows[0];
      if(!question)fail('השאלה לא נמצאה.',404);if(question.senderId===id)fail('לא ניתן לענות לשאלה של עצמך.');
      await transaction(async db=>{
        const result=await db.query('INSERT INTO community_answers VALUES($1,$2,$3,$4,$5,$6,NULL) ON CONFLICT("questionId","senderId") DO NOTHING RETURNING id',[input.id,input.questionId,id,input.choice,answerText,Date.now()]);
        if(result.rowCount)await db.query('INSERT INTO community_events(payload) VALUES($1)',[JSON.stringify({type:'answer',senderId:id,recipientId:question.senderId,questionId:input.questionId})]);
      });
      void flush();return send(res,{id:input.id},201);
    }
    if(name==='read' && req.method==='POST') {
      const input=await body(req);if(!Array.isArray(input.ids) || input.ids.length>1000 || !input.ids.every(uuid))fail('מזהים לא תקינים.');
      await transaction(async db=>{
        const result=await db.query('UPDATE community_answers SET "readAt"=$1 WHERE id=ANY($2::text[]) AND "questionId" IN(SELECT id FROM community_questions WHERE "senderId"=$3) AND "readAt" IS NULL',[Date.now(),input.ids,id]);
        if(result.rowCount)await db.query('INSERT INTO community_events(payload) VALUES($1)',[JSON.stringify({type:'refresh'})]);
      });
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
    const cursor=Number((await query('SELECT COALESCE(MAX(id),0) id FROM community_events')).rows[0].id);
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
    const events=(await query('SELECT id,payload FROM community_events WHERE id>$1 ORDER BY id LIMIT 200',[min])).rows;
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
