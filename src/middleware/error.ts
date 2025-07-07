import { NextFunction, Request, Response } from "express";
import app from "../app";

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
    console.error("❌ Error:", err);
    res.status(err.status || 500).json({
        error: err.message || "Lỗi máy chủ",
        detail: err.detail || null,
    });
}