import { Schema, model, Document } from "mongoose";

export interface IPost extends Document {
    pageId: string;
    postId: string;
    message: string;
    created_time: Date;
}

const postSchema = new Schema<IPost>({
    pageId: String,
    postId: String,
    message: String,
    created_time: Date,
});

export default model<IPost>("Post", postSchema);