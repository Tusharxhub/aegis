import { Schema, Types } from 'mongoose';

export interface IOutboxEvent {
  _id: Types.ObjectId;
  eventId: string;
  topic: string;
  key?: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
  attempts: number;
  nextAttemptAt: Date;
  lastError?: string;
  createdAt: Date;
  publishedAt?: Date;
}

export const OutboxEventSchema = new Schema<IOutboxEvent>(
  {
    eventId: { type: String, required: true, unique: true },
    topic: { type: String, required: true },
    key: { type: String, default: null },
    payload: { type: Schema.Types.Mixed, required: true },
    headers: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['PENDING', 'PUBLISHED', 'FAILED'], default: 'PENDING', index: true },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lastError: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: false },
);

// Compound index for the retry worker: find pending events ready for retry
OutboxEventSchema.index({ status: 1, nextAttemptAt: 1 });
