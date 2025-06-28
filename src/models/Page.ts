import { Schema, model, Document } from "mongoose";

export interface IPage extends Document {
    facebookId: string;
    pageId: string;
    name: string;
    access_token: string;
    expires_in: number;
    connected_at: Date;
    connected: boolean;
}

const pageSchema = new Schema<IPage>({
    facebookId: { type: String, required: true },
    pageId: { type: String, required: true },
    name: String,
    access_token: String,
    expires_in: Number,
    connected_at: Date,
    connected: { type: Boolean, default: true },
});

export default model<IPage>("Page", pageSchema);