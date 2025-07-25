import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";

interface JwtPayload {
    id: string;
    username: string;
    role: string;
    iat?: number;
    exp?: number;
}

interface AuthenticatedRequest extends Request {
    user?: JwtPayload;
}

export function authMiddleware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): void {
    let token: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
    } else if (req.query.token && typeof req.query.token === "string") {
        token = req.query.token;
    }

    if (!token) {
        res.status(401).json({ error: "Thiếu hoặc sai định dạng token (yêu cầu Bearer token)" });
        return;
    }

    if (!process.env.JWT_SECRET) {
        res.status(500).json({ error: "Cấu hình máy chủ không hợp lệ: Thiếu JWT_SECRET" });
        return;
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET) as JwtPayload;
        req.user = decoded;
        next();
    } catch (err: any) {
        if (err.name === "TokenExpiredError") {
            res.status(401).json({ error: "Token đã hết hạn" });
        } else if (err.name === "JsonWebTokenError") {
            res.status(401).json({ error: "Token không hợp lệ" });
        } else {
            res.status(401).json({ error: "Lỗi xác thực token", detail: err.message });
        }
    }
}

export const adminMiddleware = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): void => {
    if (!req.user?.role || req.user.role !== "admin") {
        res.status(403).json({ error: "Truy cập bị từ chối, yêu cầu quyền admin" });
        return;
    }
    next();
};