import { Schema, model, Document } from "mongoose";

export interface IPackage extends Document {
    name: string;
    maxPages: number;
    price: number;
    customizable: boolean;
    description?: string;
    duration?: number; // Duration in days
}

const packageSchema = new Schema<IPackage>({
    name: { type: String, required: true, unique: true, maxlength: 50 },
    maxPages: { type: Number, required: true, min: 1 },
    price: {
        type: Number, required: true, min: 0, validate: {
            validator: (v: number) => Number.isInteger(v * 100), // Ensure no excessive decimals
            message: "Price must have at most 2 decimal places"
        }
    },
    customizable: { type: Boolean, default: false },
    description: { type: String, maxlength: 500 },
    duration: { type: Number, min: 1 } // Duration in days
});

export default model<IPackage>("Package", packageSchema);