import { Schema, Types } from 'mongoose';

export interface IRemediationPlan {
  _id: Types.ObjectId;
  event: Types.ObjectId;
  incidentType?: string;
  analysis: string;
  confidenceScore: number;
  riskLevel: 'LOW' | 'HIGH';
  suggestedAction: 'RESTART_CONTAINER' | 'STOP_CONTAINER' | 'IGNORE';
  reasoning: string;
  status:
    | 'PENDING'
    | 'APPROVED'
    | 'EXECUTING'
    | 'COMPLETED'
    | 'FAILED'
    | 'SKIPPED';
  processingTimeMs?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export const RemediationPlanSchema = new Schema<IRemediationPlan>(
  {
    event: {
      type: Schema.Types.ObjectId,
      ref: 'InfrastructureEvent',
      required: true,
      unique: true,
    },
    incidentType: { type: String, default: 'UNKNOWN' },
    analysis: { type: String, required: true },
    confidenceScore: { type: Number, required: true },
    riskLevel: { type: String, enum: ['LOW', 'HIGH'], default: 'LOW' },
    suggestedAction: {
      type: String,
      enum: ['RESTART_CONTAINER', 'STOP_CONTAINER', 'IGNORE'],
      required: true,
    },
    reasoning: { type: String, required: true },
    status: {
      type: String,
      enum: [
        'PENDING',
        'APPROVED',
        'EXECUTING',
        'COMPLETED',
        'FAILED',
        'SKIPPED',
      ],
      default: 'PENDING',
    },
    processingTimeMs: { type: Number, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

RemediationPlanSchema.virtual('execution', {
  ref: 'ActionExecution',
  localField: '_id',
  foreignField: 'plan',
  justOne: true,
});
