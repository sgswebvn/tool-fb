import mongoose, { Schema } from "mongoose";

const CommentSchema = new Schema({
    facebookId: { type: String, required: true },
    postId: { type: String, required: true },
    commentId: { type: String, required: true, unique: true },
    message: { type: String, required: true },
    from: { type: String },
    created_time: { type: Date, index: true },
    parent_id: { type: String },
});

export default mongoose.model("Comment", CommentSchema);