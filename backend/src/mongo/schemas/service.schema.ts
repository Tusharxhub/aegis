import { Schema, Types } from 'mongoose';

export interface IService {
  _id: Types.ObjectId;
  containerId: string;
  name: string;
  imageName: string;
  status: 'HEALTHY' | 'DEGRADED' | 'CRASHED' | 'RESTARTING' | 'UNKNOWN';
  exitCode?: number | null;
  restartCount: number;
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
