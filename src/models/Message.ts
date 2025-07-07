import { Schema, model, Document, Types } from "mongoose";

export interface IMessage extends Document {
    pageId: string;
    senderId: string;
    senderName: string;
    recipientId: string;
    message: string;
    direction: "in" | "out";
    timestamp: Date;
    avatar?: string | null;
}

const messageSchema = new Schema<IMessage>({
    pageId: { type: String, required: true, index: true },
    senderId: String,
    senderName: String,
    recipientId: String,
    message: String,
    direction: { type: String, enum: ["in", "out"] },
    timestamp: { type: Date, default: Date.now },
    avatar: { type: String, default: null }
});

export default model<IMessage>("Message", messageSchema);