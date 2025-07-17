import { Schema, model, Document } from "mongoose";

export interface IUser extends Document {
    email: string;
    password: string;
    name: string;
    resetToken?: string;
    resetTokenExpire?: Date;
    facebookId?: string;
    facebookAccessToken?: string;
    role: "admin" | "user" | "guest";
    package: string;
    isActive: boolean;
    createdAt?: Date;
    updatedAt?: Date;
    lastLogin?: Date;
    picture?: string;
}

const userSchema = new Schema<IUser>({
    email: {
        type: String,
        required: true,
        unique: true,
        index: true,
        match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, // Validate email format
    },
    password: { type: String, required: true, minlength: 8 },
    name: { type: String, required: true },
    resetToken: { type: String },
    resetTokenExpire: { type: Date },
    facebookId: { type: String, index: true },
    facebookAccessToken: { type: String },
    role: { type: String, enum: ["admin", "user", "guest"], default: "user" },
    package: { type: String, default: "free" },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    lastLogin: { type: Date, default: Date.now },
    picture: { type: String, sparse: true },
});

// Compound index for common queries
userSchema.index({ facebookId: 1 });

export default model<IUser>("User", userSchema);