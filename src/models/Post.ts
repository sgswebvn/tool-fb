import { Schema, model, Document } from "mongoose";

interface IPost extends Document {
    pageId: string;
    postId: string;
    message: string;
    created_time: Date;
    picture?: string;
    permalink_url?: string;
    likes: number;
    shares: number;
    reactions: {
        like: number;
        love: number;
        haha: number;
        wow: number;
        sad: number;
        angry: number;
    };
    facebookId: string;
    status: "draft" | "published" | "scheduled";
}

const PostSchema = new Schema<IPost>(
    {
        pageId: {
            type: String,
            required: true,
            index: true,
        },
        postId: {
            type: String,
            required: true,
            unique: true,
        },
        message: {
            type: String,
            required: true,
        },
        created_time: {
            type: Date,
            required: true,
        },
        picture: {
            type: String,
        },
        permalink_url: {
            type: String,
        },
        likes: {
            type: Number,
            default: 0,
        },
        shares: {
            type: Number,
            default: 0,
        },
        reactions: {
            like: { type: Number, default: 0 },
            love: { type: Number, default: 0 },
            haha: { type: Number, default: 0 },
            wow: { type: Number, default: 0 },
            sad: { type: Number, default: 0 },
            angry: { type: Number, default: 0 },
        },
        facebookId: {
            type: String,
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ["draft", "published", "scheduled"],
            default: "published",
        },
    },
    {
        timestamps: true,
    }
);

PostSchema.index({ pageId: 1, facebookId: 1 });

export default model<IPost>("Post", PostSchema);