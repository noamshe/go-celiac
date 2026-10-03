import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

export const choices = ['אני/הילד שלי צורך אותו', 'ביררתי מול היצרן/יבואן', 'כתוב על האריזה / יש סימון', 'ידוע לי שלא מתאים', 'יש לי מידע נוסף', 'לא מכיר'];
const dataDir = path.resolve(process.env.DATA_DIR || 'data');
await mkdir(path.join(dataDir, 'uploads'), { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'community.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY,senderId TEXT NOT NULL REFERENCES users(id),text TEXT NOT NULL,images TEXT NOT NULL,createdAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS answers(id TEXT PRIMARY KEY,questionId TEXT NOT NULL REFERENCES questions(id),senderId TEXT NOT NULL REFERENCES users(id),choice TEXT NOT NULL,text TEXT NOT NULL,createdAt INTEGER NOT NULL,readAt INTEGER,UNIQUE(questionId,senderId));
CREATE INDEX IF NOT EXISTS question_sender ON questions(senderId);
CREATE INDEX IF NOT EXISTS answer_question ON answers(questionId);`);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function text(value, max) { if (typeof value !== 'string' || value.trim().length > max) fail('טקסט לא תקין.'); return value.trim(); }
function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req, max = 32768) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > max) fail('הקבצים גדולים מדי. עד 20MB לבקשה.', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function parseJson(req) { try { return JSON.parse((await body(req)).toString()); } catch (error) { if (error.status) throw error; fail('בקשה לא תקינה.'); } }
function snapshot(id) {
  const all = db.prepare('SELECT q.*,u.name senderName FROM questions q JOIN users u ON u.id=q.senderId ORDER BY q.createdAt ASC,q.rowid ASC').all().map(q => ({ ...q, images: JSON.parse(q.images) }));
  const answered = new Set(db.prepare('SELECT questionId FROM answers WHERE senderId=?').all(id).map(a => a.questionId));
  const answers = db.prepare('SELECT a.*,u.name senderName FROM answers a JOIN users u ON u.id=a.senderId JOIN questions q ON q.id=a.questionId WHERE q.senderId=? ORDER BY a.createdAt ASC,a.rowid ASC').all(id);
  return { type: 'snapshot', questions: all.filter(q => q.senderId !== id).map(q => ({ ...q, answered: answered.has(q.id) })), mine: all.filter(q => q.senderId === id), answers, unread: answers.filter(a => !a.readAt).length };
}
let wss;
function publish(event) {
  for (const socket of wss.clients) if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(snapshot(socket.userId)));
    if (event && ((event.type === 'question' && socket.userId !== event.senderId) || (event.type === 'answer' && socket.userId === event.recipientId))) socket.send(JSON.stringify({ type: 'event', ...event }));
  }
}
function extension(bytes) {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString())) return 'gif';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'webp';
  fail('בחר תמונות PNG, JPEG, GIF או WebP.');
}
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.webmanifest':'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) fail('מקור בקשה לא מורשה.', 403);
    if (url.pathname === '/api/health') return json(res, { ok: true });
    if (url.pathname === '/api/config' && req.method === 'GET') return json(res, { uploads:'local',configured:true });
    if (url.pathname === '/api/profile' && req.method === 'POST') {
      const profile = await parseJson(req);
      if (!uuid(profile.id)) fail('מזהה משתמש לא תקין.');
      const name = text(profile.name,40); if (!name) fail('נדרש שם.');
      db.prepare('INSERT INTO users VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(profile.id,name);
      publish(); return json(res, { ok:true });
    }
    if (url.pathname.startsWith('/api/')) {
      const id = req.headers['x-user-id'];
      if (!uuid(id) || !db.prepare('SELECT id FROM users WHERE id=?').get(id)) fail('נדרש פרופיל משתמש.',401);
      if (url.pathname === '/api/state' && req.method === 'GET') return json(res,snapshot(id));
      if (url.pathname === '/api/questions' && req.method === 'POST') {
        const buffer = await body(req,20*1024*1024);
        let form;
        try { form = await new Request('http://localhost', { method:'POST', headers:{'content-type':req.headers['content-type'] || ''}, body:buffer }).formData(); } catch { fail('לא ניתן לקרוא את התמונות.'); }
        const requestId = form.get('id'); if (!uuid(requestId)) fail('מזהה שאלה לא תקין.');
        const existing = db.prepare('SELECT senderId FROM questions WHERE id=?').get(requestId);
        if (existing) { if (existing.senderId !== id) fail('מזהה שאלה כבר קיים.',409); return json(res,{id:requestId}); }
        const questionText = text(form.get('text') || '',2000);
        const files = form.getAll('images');
        if (!questionText && !files.length) fail('הוסף תמונה או שאלה.');
        if (files.length > 6) fail('אפשר להוסיף עד 6 תמונות.');
        const images = [];
        for (const file of files) {
          if (typeof file === 'string' || file.size > 5*1024*1024) fail('עד 5MB לתמונה.');
          const bytes = Buffer.from(await file.arrayBuffer());
          images.push({ bytes, name:`${randomUUID()}.${extension(bytes)}` });
        }
        try {
          for (const image of images) await writeFile(path.join(dataDir,'uploads',image.name),image.bytes);
          db.prepare('INSERT INTO questions VALUES(?,?,?,?,?)').run(requestId,id,questionText,JSON.stringify(images.map(image => `/uploads/${image.name}`)),Date.now());
        } catch(error) { await Promise.all(images.map(image => unlink(path.join(dataDir,'uploads',image.name)).catch(() => {}))); throw error; }
        publish({type:'question',senderId:id,questionId:requestId}); return json(res,{id:requestId},201);
      }
      if (url.pathname === '/api/answers' && req.method === 'POST') {
        const input = await parseJson(req);
        if (!uuid(input.id) || !uuid(input.questionId) || !choices.includes(input.choice)) fail('תשובה לא תקינה.');
        const answerText = text(input.text || '',2000);
        const question = db.prepare('SELECT senderId FROM questions WHERE id=?').get(input.questionId);
        if (!question) fail('השאלה לא נמצאה.',404);
        if (question.senderId === id) fail('לא ניתן לענות לשאלה של עצמך.');
        const existing = db.prepare('SELECT id FROM answers WHERE questionId=? AND senderId=?').get(input.questionId,id);
        if (existing) return json(res,{id:existing.id});
        db.prepare('INSERT INTO answers VALUES(?,?,?,?,?,?,NULL)').run(input.id,input.questionId,id,input.choice,answerText,Date.now());
        publish({type:'answer',senderId:id,recipientId:question.senderId,questionId:input.questionId}); return json(res,{id:input.id},201);
      }
      if (url.pathname === '/api/read' && req.method === 'POST') {
        const input = await parseJson(req);
        if (!Array.isArray(input.ids) || input.ids.length > 1000 || !input.ids.every(uuid)) fail('מזהים לא תקינים.');
        const mark = db.prepare('UPDATE answers SET readAt=? WHERE id=? AND questionId IN (SELECT id FROM questions WHERE senderId=?) AND readAt IS NULL');
        db.exec('BEGIN'); try { for (const answerId of input.ids) mark.run(Date.now(),answerId,id); db.exec('COMMIT'); } catch(error) { db.exec('ROLLBACK'); throw error; }
        publish(); return json(res,{ok:true});
      }
      fail('לא נמצא.',404);
    }
    if (!['GET','HEAD'].includes(req.method)) fail('לא נמצא.',404);
    const upload = url.pathname.startsWith('/uploads/');
    const root = upload ? path.join(dataDir,'uploads') : path.resolve('dist');
    const relative = upload ? url.pathname.slice(9) : decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const filename = path.resolve(root,relative);
    if (!filename.startsWith(root+path.sep)) fail('לא נמצא.',404);
    let content; try { content = await readFile(filename); } catch { fail('לא נמצא.',404); }
    res.writeHead(200,{'Content-Type':mime[path.extname(filename)] || 'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':upload ? 'public, max-age=31536000, immutable' : 'no-cache'});
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch(error) { if (!error.status) console.error(error); if (!res.headersSent) json(res,{error:error.status ? error.message : 'אירעה שגיאת שרת. נסה שוב.'},error.status || 500); else res.end(); }
});
wss = new WebSocketServer({ noServer:true,maxPayload:4096 });
server.on('upgrade',(req,socket,head) => {
  const url = new URL(req.url,'http://localhost');
  const id = url.searchParams.get('id');
  const validOrigin = !req.headers.origin || [`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin);
  if (url.pathname !== '/live' || !validOrigin || !uuid(id) || !db.prepare('SELECT id FROM users WHERE id=?').get(id)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req,socket,head,ws => { ws.userId=id; wss.emit('connection',ws); });
});
wss.on('connection',socket => {
  socket.alive=true;
  socket.on('pong',() => { socket.alive=true; });
  socket.on('error',() => {});
  socket.send(JSON.stringify(snapshot(socket.userId)));
});
const heartbeat = setInterval(() => { for (const socket of wss.clients) { if (!socket.alive) socket.terminate(); else { socket.alive=false; socket.ping(); } } },30000);
server.listen(Number(process.env.PORT || 4173),'0.0.0.0',() => console.log(`Community app: http://localhost:${server.address().port}`));
function shutdown() { clearInterval(heartbeat); for (const socket of wss.clients) socket.close(); server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
