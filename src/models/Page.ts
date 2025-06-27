import { Schema, model, Document, Types } from "mongoose";

export interface IPage extends Document {
    userId: Types.ObjectId;
    pageId: string;
    name: string;
    access_token: string;
    expires_in?: number;
    connected_at: Date;
}

const pageSchema = new Schema<IPage>({
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    pageId: { type: String, required: true },
    name: { type: String, required: true },
    access_token: { type: String, required: true },
    expires_in: { type: Number },
    connected_at: { type: Date, default: Date.now },
});

export default model<IPage>("Page", pageSchema);