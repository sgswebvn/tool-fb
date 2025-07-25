import { Request, Response, NextFunction } from "express";
import winston from "winston";

interface CustomRequest extends Request {
    user?: { id: string; username: string; role: string };
}

export const errorMiddleware = (err: any, req: CustomRequest, res: Response, next: NextFunction): void => {
    const logger = req.app.get("logger") as winston.Logger;

    const errorDetails = {
        message: err.message || "Lỗi không xác định",
        status: err.status || 500,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
        userId: req.user?.id || "unknown",
        path: req.path,
        method: req.method,
    };

    logger.error("Error occurred", errorDetails);
    res.status(errorDetails.status).json({
        error: errorDetails.message,
        detail: process.env.NODE_ENV === "development" ? err.stack : undefined,

    });
    logger.error("🔥 Full error caught", err);

};