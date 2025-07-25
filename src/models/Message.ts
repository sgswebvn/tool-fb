import { Schema, model, Document } from "mongoose";

export interface IMessage extends Document {
    _id: string;
    pageId: string;
    conversationId: string;
    facebookId: string;
    senderId: string;
    senderName: string;
    recipientId: string;
    message: string;
    direction: "in" | "out";
    timestamp: Date;
    avatar?: string | null;
    attachments?: { type: string; url: string }[];
    followed: boolean;
    status: "sent" | "delivered" | "read" | "failed";
}

const messageSchema = new Schema<IMessage>(
    {
        _id: { type: String, required: true }, // dùng id của bạn làm _id chính
        pageId: { type: String, required: true },
        conversationId: { type: String, required: true },
        facebookId: { type: String, required: true },
        senderId: { type: String, required: true },
        senderName: { type: String, required: true },
        recipientId: { type: String, required: true },
        message: { type: String, required: true, maxlength: 2000 },
        direction: { type: String, enum: ["in", "out"], required: true },
        timestamp: { type: Date, required: true },
        avatar: { type: String },
        attachments: [
            {
                type: { type: String },
                url: { type: String }
            }
        ],
        followed: { type: Boolean, default: false },
        status: {
            type: String,
            enum: ["sent", "delivered", "read", "failed"],
            default: "sent"
        }
    },
    {
        _id: false, // ✅ không cho Mongoose tự tạo ObjectId
        timestamps: false
    }
);
// Compound indexes
messageSchema.index({ pageId: 1, facebookId: 1 });
messageSchema.index({ senderId: 1, recipientId: 1, conversationId: 1 });
messageSchema.index({ timestamp: 1 });
// Validate unique id before saving
messageSchema.pre("save", async function (next) {
    const existing = await this.model("Message").findOne({ id: this.id });
    if (existing && !existing._id.equals(this._id)) {
        throw new Error("Message ID already exists");
    }
    next();
});

export default model<IMessage>("Message", messageSchema);