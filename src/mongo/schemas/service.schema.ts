import { Schema, Types } from 'mongoose';

export interface IService {
  _id: Types.ObjectId;
  containerId: string;
  name: string;
  imageName: string;
  status: 'HEALTHY' | 'DEGRADED' | 'CRASHED' | 'RESTARTING' | 'UNKNOWN';
  exitCode?: number | null;
  restartCount: number;
  lastRemediationAt: Date | null;
  lastCrashAt: Date | null;
  totalCrashCount: number;
  owner?: string;
  tags?: string[];
  maxRestartsPerHour?: number;
  monitoringEnabled: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const ServiceSchema = new Schema<IService>(
  {
    containerId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    imageName: { type: String, required: true },
    status: {
      type: String,
      enum: ['HEALTHY', 'DEGRADED', 'CRASHED', 'RESTARTING', 'UNKNOWN'],
      default: 'HEALTHY',
    },
    exitCode: { type: Number, default: null },
    restartCount: { type: Number, default: 0 },
    lastRemediationAt: { type: Date, default: null },
    lastCrashAt: { type: Date, default: null },
    totalCrashCount: { type: Number, default: 0 },
    owner: { type: String, default: null },
    tags: { type: [String], default: [] },
    maxRestartsPerHour: { type: Number, default: null },
    monitoringEnabled: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

ServiceSchema.virtual('events', {
  ref: 'InfrastructureEvent',
  localField: '_id',
  foreignField: 'service',
});
