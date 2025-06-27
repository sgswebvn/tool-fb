import { Schema, model, Document } from "mongoose";

export interface IComment extends Document {
    postId: string;
    commentId: string;
    message: string;
    from: string;
    created_time: Date;
}

const commentSchema = new Schema<IComment>({
    postId: String,
    commentId: String,
    message: String,
    from: String,
    created_time: Date,
});

export default model<IComment>("Comment", commentSchema);