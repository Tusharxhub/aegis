import { Schema, Types } from 'mongoose';

export interface IMetricsSnapshot {
  _id: Types.ObjectId;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  timestamp: Date;
}

export const MetricsSnapshotSchema = new Schema<IMetricsSnapshot>({
  cpuUsage: { type: Number, required: true },
  memoryUsage: { type: Number, required: true },
  diskUsage: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
});
