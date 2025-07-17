import mongoose, { Schema } from "mongoose";

const PostSchema = new Schema({
    facebookId: { type: String, required: true, index: true },
    pageId: { type: String, required: true, index: true },
    postId: { type: String, required: true, unique: true },
    message: { type: String },
    created_time: { type: Date, required: true, index: true },
    picture: { type: String, sparse: true },
    likes: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    reactions: {
        like: { type: Number, default: 0 },
        love: { type: Number, default: 0 },
        haha: { type: Number, default: 0 },
        wow: { type: Number, default: 0 },
        sad: { type: Number, default: 0 },
        angry: { type: Number, default: 0 },
    },
});

// Compound index for common queries
PostSchema.index({ pageId: 1, facebookId: 1 });

export default mongoose.model("Post", PostSchema);