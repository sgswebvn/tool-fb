import mongoose, { Schema } from "mongoose";

const PostSchema = new Schema({
    pageId: { type: String, required: true },
    postId: { type: String, required: true, unique: true },
    message: { type: String },
    created_time: { type: Date, index: true },
    picture: { type: String, default: null},
});

export default mongoose.model("Post", PostSchema);