import mongoose, { Schema } from "mongoose";

const PageSchema = new Schema({
    facebookId: { type: String, required: true },
    pageId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    picture: { type: String },
    access_token: { type: String, required: true },
    expires_in: { type: Number },
    connected_at: { type: Date, default: Date.now },
    connected: { type: Boolean, default: true },
});

export default mongoose.model("Page", PageSchema);