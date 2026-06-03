import { MongoClient, ObjectId, type Collection } from "mongodb";
import type { Task } from "../../shared/tasks.js";

export type TaskDocument = Omit<Task, "id"> & {
  _id: ObjectId;
};

declare global {
  var __justodoMongoClientPromise: Promise<MongoClient> | undefined;
}

let indexesCreated = false;

function getMongoUri() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("Missing MONGODB_URI. Add your MongoDB Atlas connection string to .env or Vercel environment variables.");
  }

  return uri;
}

async function getClient() {
  if (!globalThis.__justodoMongoClientPromise) {
    globalThis.__justodoMongoClientPromise = new MongoClient(getMongoUri()).connect();
  }

  return globalThis.__justodoMongoClientPromise;
}

async function ensureIndexes(collection: Collection<TaskDocument>) {
  if (indexesCreated) {
    return;
  }

  await Promise.all([
    collection.createIndex({ deletedAt: 1, status: 1, type: 1, createdAt: -1 }),
    collection.createIndex({ dueAt: 1 }),
    collection.createIndex({ updatedAt: -1 })
  ]);

  indexesCreated = true;
}

export async function getTasksCollection() {
  const client = await getClient();
  const db = client.db(process.env.MONGODB_DB || "justodo");
  const collection = db.collection<TaskDocument>("tasks");

  await ensureIndexes(collection);

  return collection;
}

export function serializeTask(document: TaskDocument): Task {
  const { _id, ...task } = document;
  const hasDueDate = task.hasDueDate ?? (task.type === "recurring" ? false : Boolean(task.dueAt));

  return {
    ...task,
    dueAt: hasDueDate ? task.dueAt : null,
    hasDueDate,
    recurringHistory:
      task.type === "recurring" && task.recurringHistory
        ? task.recurringHistory.map((entry) => ({
            ...entry,
            nextDueAt: hasDueDate ? entry.nextDueAt : null
          }))
        : task.recurringHistory,
    id: _id.toHexString()
  };
}
