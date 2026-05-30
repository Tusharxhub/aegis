import { Schema, Types } from 'mongoose';

export interface IActionExecution {
  _id: Types.ObjectId;
  plan: Types.ObjectId;
  actionTaken: string;
  isSuccessful: boolean;
  executionLogs?: string | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  executedAt: Date;
}

export const ActionExecutionSchema = new Schema<IActionExecution>({
  plan: {
    type: Schema.Types.ObjectId,
    ref: 'RemediationPlan',
    required: true,
    unique: true,
  },
  actionTaken: { type: String, required: true },
  isSuccessful: { type: Boolean, required: true },
  executionLogs: { type: String, default: '' },
  durationMs: { type: Number, default: null },
  errorMessage: { type: String, default: null },
  executedAt: { type: Date, default: Date.now },
});
