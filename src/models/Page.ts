import { Schema, model, Document } from "mongoose";
import crypto from "crypto";

interface IPage extends Document {
    pageId: string;
    facebookId: string;
    name: string;
    access_token: string;
    expires_in?: number;
    connected: boolean;
    connected_at: Date;
    picture?: string;
    getDecryptedAccessToken(): string | null;
}

const PageSchema = new Schema<IPage>(
    {
        pageId: {
            type: String,
            required: true,
            unique: true,
        },
        facebookId: {
            type: String,
            required: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
        },
        access_token: {
            type: String,
            required: true,
            select: false,
        },
        expires_in: {
            type: Number,
        },
        connected: {
            type: Boolean,
            default: true,
        },
        connected_at: {
            type: Date,
            required: true,
        },
        picture: {
            type: String,
        },
    },
    {
        timestamps: true,
    }
);

// Encrypt access_token before saving
PageSchema.pre("save", async function (next) {
    if (this.isModified("access_token") && this.access_token) {
        const key = process.env.ENCRYPTION_KEY;
        if (!key) {
            throw new Error("ENCRYPTION_KEY không được cấu hình");
        }
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(key, "hex"), iv);
        let encrypted = cipher.update(this.access_token, "utf8", "hex");
        encrypted += cipher.final("hex");
        this.access_token = `${iv.toString("hex")}:${encrypted}`;
    }
    next();
});

// Method to decrypt access_token
PageSchema.methods.getDecryptedAccessToken = function () {
    if (!this.access_token) return null;
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        throw new Error("ENCRYPTION_KEY không được cấu hình");
    }
    const [iv, encrypted] = this.access_token.split(":");
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "hex"), Buffer.from(iv, "hex"));
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
};

PageSchema.index({ facebookId: 1, pageId: 1 });

export default model<IPage>("Page", PageSchema);