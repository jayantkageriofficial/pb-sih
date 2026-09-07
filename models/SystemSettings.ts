import mongoose, { Document, Model, Schema, Types } from "mongoose";

export interface ISystemSettings extends Document {
  key: "global";
  resultsPublished: boolean;
  resultsPublishedAt: Date | null;
  resultsPublishedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const systemSettingsSchema = new Schema<ISystemSettings>(
  {
    key: {
      type: String,
      enum: ["global"],
      default: "global",
      unique: true,
      immutable: true,
    },
    resultsPublished: {
      type: Boolean,
      default: false,
    },
    resultsPublishedAt: {
      type: Date,
      default: null,
    },
    resultsPublishedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true }
);

export const SystemSettings: Model<ISystemSettings> =
  mongoose.models.SystemSettings ||
  mongoose.model<ISystemSettings>("SystemSettings", systemSettingsSchema);
