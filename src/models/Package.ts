import { Schema, model, Document } from "mongoose";

export interface IPackage extends Document {
    name: string;
    maxPages: number;
    price: number;
    customizable?: boolean;
}

const packageSchema = new Schema<IPackage>({
    name: { type: String, required: true, unique: true },
    maxPages: { type: Number, required: true },
    price: { type: Number, required: true },
    customizable: { type: Boolean, default: false },
});

export default model<IPackage>("Package", packageSchema);