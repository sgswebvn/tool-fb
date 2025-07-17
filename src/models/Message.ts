import { Schema, model, Document } from "mongoose";

export interface IMessage extends Document {
    id: string;
    pageId: string;
    facebookId: string;
    senderId: string;
    senderName: string;
    recipientId: string;
    message: string;
    direction: "in" | "out";
    timestamp: Date;
    avatar?: string | null;
    attachments?: { type: string; url: string }[];
}

const messageSchema = new Schema<IMessage>({
    id: { type: String, required: true, unique: true },
    pageId: { type: String, required: true, index: true },
    facebookId: { type: String, required: true, index: true },
    senderId: { type: String, required: true, index: true },
    senderName: { type: String, required: true },
    recipientId: { type: String, required: true, index: true },
    message: { type: String, required: true },
    direction: { type: String, enum: ["in", "out"], required: true },
    timestamp: { type: Date, default: Date.now, index: true },
    avatar: { type: String, sparse: true },
    attachments: [{ type: { type: String }, url: { type: String } }],
});

// Compound index for common queries
messageSchema.index({ pageId: 1, facebookId: 1 });
messageSchema.index({ senderId: 1, recipientId: 1 });

export default model<IMessage>("Message", messageSchema);