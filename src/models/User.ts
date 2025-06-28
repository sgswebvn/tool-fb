import { Schema, model, Document } from "mongoose";

export interface IUser extends Document {
    email: string;
    password: string;
    name: string;
    resetToken?: string;
    resetTokenExpire?: Date;
    facebookId?: string;
    facebookAccessToken?: string;
}

const userSchema = new Schema<IUser>({
    email: { type: String, unique: true },
    password: String,
    name: String,
    resetToken: String,
    resetTokenExpire: Date,
    facebookId: String,
    facebookAccessToken: String,
});

export default model<IUser>("User", userSchema);