import mongoose, { Schema } from "mongoose";

const PostSchema = new Schema({
    pageId: { type: String, required: true },
    postId: { type: String, required: true, unique: true },
    message: { type: String },
    created_time: { type: Date, index: true },
});

export default mongoose.model("Post", PostSchema);