import { Schema, model, Document } from "mongoose";

interface IComment extends Document {
    postId: string;
    commentId: string;
    message: string;
    from: string;
    picture?: string;
    created_time: Date;
    parent_id?: string;
    facebookId: string;
    hidden: boolean;
    status: "pending" | "approved" | "rejected";
    reactions: {
        like: number;
        love: number;
        haha: number;
        wow: number;
        sad: number;
        angry: number;
    };
}

const CommentSchema = new Schema<IComment>(
    {
        postId: {
            type: String,
            required: true,
            index: true,
        },
        commentId: {
            type: String,
            required: true,
            unique: true,
        },
        message: {
            type: String,
            required: true,
        },
        from: {
            type: String,
            required: true,
        },
        picture: {
            type: String,
        },
        created_time: {
            type: Date,
            required: true,
        },
        parent_id: {
            type: String,
        },
        facebookId: {
            type: String,
            required: true,
            index: true,
        },
        hidden: {
            type: Boolean,
            default: false,
        },
        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
        },
        reactions: {
            like: { type: Number, default: 0 },
            love: { type: Number, default: 0 },
            haha: { type: Number, default: 0 },
            wow: { type: Number, default: 0 },
            sad: { type: Number, default: 0 },
            angry: { type: Number, default: 0 },
        },
    },
    {
        timestamps: true,
    }
);

CommentSchema.index({ postId: 1, facebookId: 1 });

export default model<IComment>("Comment", CommentSchema);