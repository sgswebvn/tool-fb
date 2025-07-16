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
    email: { type: String, unique: true, index: true },
    password: String,
    name: String,
    resetToken: String,
    resetTokenExpire: Date,
    facebookId: String,
    facebookAccessToken: String,
    role: { type: String, enum: ["admin", "user", "guest"], default: "user" },
    package: { type: String, default: "free" },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    lastLogin: { type: Date, default: Date.now },
    picture: String,
});

export default model<IUser>("User", userSchema);