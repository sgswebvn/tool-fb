import { Schema, model, Document } from "mongoose";
import validator from "validator";
import crypto from "crypto";

// Interface for User document
interface IUser extends Document {
    name: string;
    email: string;
    password: string;
    role: "admin" | "user" | "guest";
    facebookId?: string;
    facebookAccessToken?: string;
    isActive: boolean;
    package: string;
    packageExpiry?: Date; // Added: packageExpiry field
    createdAt: Date;
    updatedAt: Date;
    getDecryptedAccessToken(): string | null;
}

// Mongoose schema for User
const UserSchema = new Schema<IUser>(
    {
        name: {
            type: String,
            required: [true, "Tên là bắt buộc"],
            trim: true,
            minlength: [2, "Tên phải có ít nhất 2 ký tự"],
            maxlength: [50, "Tên không được vượt quá 50 ký tự"],
        },
        email: {
            type: String,
            required: [true, "Email là bắt buộc"],
            unique: true,
            index: true,
            validate: {
                validator: (value: string) => validator.isEmail(value),
                message: "Email không hợp lệ",
            },
        },
        password: {
            type: String,
            required: [true, "Mật khẩu là bắt buộc"],
            minlength: [6, "Mật khẩu phải có ít nhất 6 ký tự"],
        },
        role: {
            type: String,
            enum: ["admin", "user", "guest"],
            default: "user",
        },
        facebookId: {
            type: String,
            index: true,
            sparse: true,
        },
        facebookAccessToken: {
            type: String,
            select: false,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        package: {
            type: String,
            default: "basic",
        },
        packageExpiry: { // Added: packageExpiry field
            type: Date,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
        updatedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true, // Automatically manages createdAt and updatedAt
    }
);

// Pre-save middleware to update `updatedAt`
UserSchema.pre("save", function (next) {
    this.updatedAt = new Date();
    next();
});

// Encrypt facebookAccessToken before saving
UserSchema.pre("save", async function (next) {
    if (this.isModified("facebookAccessToken") && this.facebookAccessToken) {
        const key = process.env.ENCRYPTION_KEY;
        if (!key) {
            throw new Error("ENCRYPTION_KEY không được cấu hình");
        }
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(key, "hex"), iv);
        let encrypted = cipher.update(this.facebookAccessToken, "utf8", "hex");
        encrypted += cipher.final("hex");
        this.facebookAccessToken = `${iv.toString("hex")}:${encrypted}`;
    }
    next();
});

// Method to decrypt facebookAccessToken
UserSchema.methods.getDecryptedAccessToken = function () {
    if (!this.facebookAccessToken) return null;
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        throw new Error("ENCRYPTION_KEY không được cấu hình");
    }
    const [iv, encrypted] = this.facebookAccessToken.split(":");
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "hex"), Buffer.from(iv, "hex"));
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
};

export default model<IUser>("User", UserSchema);