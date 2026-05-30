import { Schema, Types } from 'mongoose';

export interface IInfrastructureEvent {
  _id: Types.ObjectId;
  service: Types.ObjectId;
  eventType: 'DIE' | 'OOM' | 'KILL' | 'HEALTH_CHECK_FAIL';
  exitCode?: number | null;
  rawLogs: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

export const InfrastructureEventSchema = new Schema<IInfrastructureEvent>({
  service: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
  eventType: {
    type: String,
    enum: ['DIE', 'OOM', 'KILL', 'HEALTH_CHECK_FAIL'],
    required: true,
  },
  exitCode: { type: Number, default: null },
  rawLogs: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, default: Date.now }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

InfrastructureEventSchema.virtual('embedding', {
  ref: 'IncidentEmbedding',
  localField: '_id',
  foreignField: 'event',
  justOne: true
});

InfrastructureEventSchema.virtual('remediation', {
  ref: 'RemediationPlan',
  localField: '_id',
  foreignField: 'event',
  justOne: true
});
