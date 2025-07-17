import mongoose, { Schema } from "mongoose";

const PostSchema = new Schema({
    pageId: { type: String, required: true },
    postId: { type: String, required: true, unique: true },
    message: { type: String },
    created_time: { type: Date, index: true },
    picture: { type: String, default: null },
    likes: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
});

export default mongoose.model("Post", PostSchema);