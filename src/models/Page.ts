import { Schema, model, Document, Types } from "mongoose";

export interface IPage extends Document {
    userId: Types.ObjectId;
    pageId: string;
    name: string;
    access_token: string;
    connected_at: Date;
}

const pageSchema = new Schema<IPage>({
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    pageId: String,
    name: String,
    access_token: String,
    connected_at: { type: Date, default: Date.now },
});

export default model<IPage>("Page", pageSchema);