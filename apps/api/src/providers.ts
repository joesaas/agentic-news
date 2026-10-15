import { Queue } from "bullmq";
import IORedis from "ioredis";
import { QUEUES, type RawItemJob } from "@agentic-news/shared";
import { createDb, type Db } from "@agentic-news/storage";
import { config } from "./config";

export const DB_TOKEN = "DB";
export const RAW_QUEUE_TOKEN = "RAW_QUEUE";

let dbSingleton: Db | null = null;
export function getDb(): Db {
  if (!dbSingleton) dbSingleton = createDb(config.databaseUrl).db;
  return dbSingleton;
}

let queueSingleton: Queue<RawItemJob> | null = null;
export function getRawQueue(): Queue<RawItemJob> {
  if (!queueSingleton) {
    const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
    queueSingleton = new Queue<RawItemJob>(QUEUES.rawItems, { connection });
  }
  return queueSingleton;
}
