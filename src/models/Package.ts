import { Schema, model, Document } from "mongoose";

export interface IPackage extends Document {
    name: string;
    maxPages: number;
    price: number;
    customizable?: boolean;
}

const packageSchema = new Schema<IPackage>({
    name: { type: String, required: true, unique: true, index: true },
    maxPages: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    customizable: { type: Boolean, default: false },
});

export default model<IPackage>("Package", packageSchema);