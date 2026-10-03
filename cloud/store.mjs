import { MongoClient } from 'mongodb';

export const DATABASE_NAME = 'go-celiac-db';
let client;
let initialization;
export function configured() { return !!process.env.MONGODB_URI; }
export async function database() {
  if (!configured()) throw Object.assign(new Error('הגדר MONGODB_URI בפרויקט Vercel כדי להתחבר ל-MongoDB Atlas.'), { status: 503 });
  if (!initialization) {
    client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
    initialization = (async () => {
      await client.connect();
      // Explicitly select this database regardless of the URI's default database.
      const db = client.db(DATABASE_NAME);
      await Promise.all([
        db.collection('questions').createIndex({ senderId: 1 }),
        db.collection('questions').createIndex({ sequence: 1 }),
        db.collection('answers').createIndex({ questionId: 1, senderId: 1 }, { unique: true }),
        db.collection('answers').createIndex({ recipientId: 1, createdAt: 1 }),
        db.collection('uploads').createIndex({ senderId: 1, questionId: 1 }),
        db.collection('events').createIndex({ id: 1 }, { unique: true }),
      ]);
      await db.collection('counters').updateOne({ _id: 'events' }, { $setOnInsert: { value: 0 } }, { upsert: true });
      return db;
    })().catch(async error => { initialization = null; await client.close(); throw error; });
  }
  return initialization;
}
export async function closeDatabase() {
  if (client) await client.close();
  client = null; initialization = null;
}
async function transaction(action) {
  const db = await database();
  const session = client.startSession();
  try { return await session.withTransaction(() => action(db, session)); }
  finally { await session.endSession(); }
}
async function event(db, session, payload) {
  const counter = await db.collection('counters').findOneAndUpdate({ _id: 'events' }, { $inc: { value: 1 } }, { session, returnDocument: 'after' });
  await db.collection('events').insertOne({ id: counter.value, payload }, { session });
  return counter.value;
}
function publicDocument({ _id, ...document }) { return document; }
export async function exists(id) { return !!await (await database()).collection('users').findOne({ _id: id }, { projection: { _id: 1 } }); }
export async function saveProfile(id, name) {
  await transaction(async (db, session) => {
    await db.collection('users').updateOne({ _id: id }, { $set: { name } }, { upsert: true, session });
    await event(db, session, { type: 'refresh' });
  });
}
export async function question(id) { return (await database()).collection('questions').findOne({ _id: id }); }
export async function reserveUpload(path, senderId, questionId) {
  return transaction(async (db, session) => {
    const collection = db.collection('uploads');
    if (await collection.findOne({ _id: path }, { session })) return true;
    await db.collection('upload_limits').updateOne({ _id: questionId }, { $inc: { version: 1 } }, { upsert: true, session });
    if (await collection.countDocuments({ senderId, questionId }, { session }) >= 6) return false;
    await collection.insertOne({ _id: path, senderId, questionId }, { session });
    return true;
  });
}
export async function ownsUpload(path, senderId, questionId) {
  return !!await (await database()).collection('uploads').findOne({ _id: path, senderId, questionId });
}
export async function saveQuestion(input) {
  return transaction(async (db, session) => {
    const collection = db.collection('questions');
    const existing = await collection.findOne({ _id: input.id }, { session });
    if (existing) return existing.senderId === input.senderId;
    const sequence = await event(db, session, { type: 'question', senderId: input.senderId, questionId: input.id });
    await collection.insertOne({ _id: input.id, ...input, sequence }, { session });
    return true;
  });
}
export async function saveAnswer(input) {
  return transaction(async (db, session) => {
    const collection = db.collection('answers');
    const existing = await collection.findOne({ questionId: input.questionId, senderId: input.senderId }, { session });
    if (existing) return existing.id;
    await collection.insertOne({ _id: input.id, ...input, readAt: null }, { session });
    await event(db, session, { type: 'answer', senderId: input.senderId, recipientId: input.recipientId, questionId: input.questionId });
    return input.id;
  });
}
export async function markRead(ids, recipientId) {
  await transaction(async (db, session) => {
    const result = await db.collection('answers').updateMany({ _id: { $in: ids }, recipientId, readAt: null }, { $set: { readAt: Date.now() } }, { session });
    if (result.modifiedCount) await event(db, session, { type: 'refresh' });
  });
}
export async function latestEvent() {
  return (await (await database()).collection('events').find().sort({ id: -1 }).limit(1).next())?.id ?? 0;
}
export async function eventsAfter(id) {
  return (await database()).collection('events').find({ id: { $gt: id } }).sort({ id: 1 }).limit(200).toArray();
}
export async function snapshot(id) {
  const db = await database();
  const [questions, answered, answers, users] = await Promise.all([
    db.collection('questions').find().sort({ sequence: 1 }).toArray(),
    db.collection('answers').find({ senderId: id }, { projection: { questionId: 1 } }).toArray(),
    db.collection('answers').find({ recipientId: id }).sort({ createdAt: 1, id: 1 }).toArray(),
    db.collection('users').find().toArray(),
  ]);
  const names = new Map(users.map(user => [user._id, user.name]));
  const answeredIds = new Set(answered.map(answer => answer.questionId));
  const named = document => ({ ...publicDocument(document), senderName: names.get(document.senderId) || '' });
  return { type: 'snapshot', questions: questions.filter(q => q.senderId !== id).map(q => ({ ...named(q), answered: answeredIds.has(q.id) })), mine: questions.filter(q => q.senderId === id).map(named), answers: answers.map(named), unread: answers.filter(a => !a.readAt).length };
}
