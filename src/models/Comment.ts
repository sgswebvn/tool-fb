import { Schema, model, Document } from "mongoose";

export interface IComment extends Document {
    facebookId: string;
    postId: string;
    commentId: string;
    message: string;
    from: string;
    created_time: string;
    parent_id?: string;
}

const commentSchema = new Schema<IComment>({
    facebookId: { type: String, required: true },
    postId: { type: String, required: true },
    commentId: { type: String, required: true },
    message: String,
    from: String,
    created_time: String,
    parent_id: { type: String, default: null },
});

export default model<IComment>("Comment", commentSchema);