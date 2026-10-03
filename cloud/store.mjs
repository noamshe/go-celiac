import pg from 'pg';

let pool;
let initialization;
export function configured() { return !!(process.env.DATABASE_URL || process.env.POSTGRES_URL); }
export function connection() {
  if(!configured())throw Object.assign(new Error('חבר מסד נתונים Postgres לפרויקט Vercel והגדר DATABASE_URL.'),{status:503});
  pool ||= new pg.Pool({connectionString:process.env.DATABASE_URL || process.env.POSTGRES_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
  return pool;
}
export async function initialize() {
  if(!initialization)initialization=connection().query(`
    CREATE TABLE IF NOT EXISTS community_users(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS community_questions(id TEXT PRIMARY KEY,"senderId" TEXT NOT NULL REFERENCES community_users(id),text TEXT NOT NULL,images JSONB NOT NULL,"createdAt" DOUBLE PRECISION NOT NULL,sequence BIGSERIAL UNIQUE);
    CREATE TABLE IF NOT EXISTS community_answers(id TEXT PRIMARY KEY,"questionId" TEXT NOT NULL REFERENCES community_questions(id),"senderId" TEXT NOT NULL REFERENCES community_users(id),choice TEXT NOT NULL,text TEXT NOT NULL,"createdAt" DOUBLE PRECISION NOT NULL,"readAt" DOUBLE PRECISION,UNIQUE("questionId","senderId"));
    CREATE TABLE IF NOT EXISTS community_events(id BIGSERIAL PRIMARY KEY,payload JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS community_uploads(path TEXT PRIMARY KEY,"senderId" TEXT NOT NULL REFERENCES community_users(id),"questionId" TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS community_answers_question ON community_answers("questionId");
    CREATE INDEX IF NOT EXISTS community_questions_sender ON community_questions("senderId");
  `).catch(error=>{initialization=null;throw error;});
  await initialization;
}
export async function query(sql,args=[]) {await initialize();return connection().query(sql,args);}
export async function transaction(action) {
  await initialize();const client=await connection().connect();
  try {await client.query('BEGIN');const result=await action(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
export async function snapshot(id) {
  const [questions,answered,answers]=await Promise.all([
    query('SELECT q.id,q."senderId",q.text,q.images,q."createdAt",u.name AS "senderName" FROM community_questions q JOIN community_users u ON u.id=q."senderId" ORDER BY q.sequence ASC'),
    query('SELECT "questionId" FROM community_answers WHERE "senderId"=$1',[id]),
    query('SELECT a.*,u.name AS "senderName" FROM community_answers a JOIN community_users u ON u.id=a."senderId" JOIN community_questions q ON q.id=a."questionId" WHERE q."senderId"=$1 ORDER BY a."createdAt",a.id',[id]),
  ]);
  const answeredIds=new Set(answered.rows.map(row=>row.questionId));
  return {type:'snapshot',questions:questions.rows.filter(q=>q.senderId!==id).map(q=>({...q,answered:answeredIds.has(q.id)})),mine:questions.rows.filter(q=>q.senderId===id),answers:answers.rows,unread:answers.rows.filter(a=>!a.readAt).length};
}
export async function exists(id) {return !!(await query('SELECT id FROM community_users WHERE id=$1',[id])).rows[0];}
