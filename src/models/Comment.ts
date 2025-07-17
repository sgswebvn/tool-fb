import mongoose, { Schema } from "mongoose";

const CommentSchema = new Schema({
    facebookId: { type: String, required: true },
    postId: { type: String, required: true },
    commentId: { type: String, required: true, unique: true },
    message: { type: String, required: true },
    from: { type: String },
    picture: { type: String, default: null },
    created_time: { type: Date, index: true },
    parent_id: { type: String },
    direction: { type: String, enum: ["in", "out"], default: "in" },
    hidden: { type: Boolean, default: false },
});

export default mongoose.model("Comment", CommentSchema);