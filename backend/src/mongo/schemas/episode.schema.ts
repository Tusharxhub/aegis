import { Schema, Types } from 'mongoose';

export interface IEpisode {
  _id: Types.ObjectId;
  state_vector: number[];
  action_taken: number;
  reward: number;
  next_state_vector: number[];
  timestamp: Date;
  containerName: string;
  imageName: string;
  exitCode: number;
  eventType: string;
}

export const EpisodeSchema = new Schema<IEpisode>({
  state_vector: { type: [Number], required: true },
  action_taken: { type: Number, required: true },
  reward: { type: Number, required: true },
  next_state_vector: { type: [Number], required: true },
  timestamp: { type: Date, default: Date.now },
  containerName: { type: String, required: true },
  imageName: { type: String, required: true },
  exitCode: { type: Number, required: true },
  eventType: { type: String, required: true },
});
