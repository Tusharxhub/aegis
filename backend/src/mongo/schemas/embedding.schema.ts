import { Schema, Types } from 'mongoose';

export interface IIncidentEmbedding {
  _id: Types.ObjectId;
  event: Types.ObjectId;
  vector: number[];
  incidentType: string;
  createdAt: Date;
}

export const IncidentEmbeddingSchema = new Schema<IIncidentEmbedding>({
  event: { type: Schema.Types.ObjectId, ref: 'InfrastructureEvent', required: true, unique: true },
  vector: { type: [Number], required: true },
  incidentType: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
