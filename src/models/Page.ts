import mongoose, { Schema } from "mongoose";

const PageSchema = new Schema({
    facebookId: { type: String, required: true, index: true },
    pageId: {
        type: String,
        required: true,
        unique: true,
        match: /^[0-9_]+$/,
    },
    name: { type: String, required: true },
    picture: { type: String, sparse: true },
    access_token: { type: String, required: true },
    expires_in: { type: Number },
    connected_at: { type: Date, default: Date.now },
    connected: { type: Boolean, default: true },
});

PageSchema.index({ facebookId: 1, pageId: 1 });

export default mongoose.model("Page", PageSchema);