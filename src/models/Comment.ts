import mongoose, { Schema } from "mongoose";

const CommentSchema = new Schema({
    facebookId: { type: String, required: true, index: true },
    postId: { type: String, required: true, index: true },
    commentId: { type: String, required: true, unique: true },
    message: { type: String, required: true },
    from: { type: String, required: true },
    picture: { type: String, sparse: true },
    created_time: { type: Date, required: true, index: true },
    parent_id: { type: String },
    direction: { type: String, enum: ["in", "out"], default: "in" },
    hidden: { type: Boolean, default: false },
    attachments: [{ type: { type: String }, url: { type: String } }],
});

// Compound index for common queries
CommentSchema.index({ postId: 1, facebookId: 1 });

export default mongoose.model("Comment", CommentSchema);