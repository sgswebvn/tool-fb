import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

interface JwtPayload {
    id: string;
    username: string;
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
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Thiếu hoặc sai định dạng token (yêu cầu Bearer token)" });
        return;
    }

    const token = authHeader.split(" ")[1];

    if (!process.env.JWT_SECRET) {
        res.status(500).json({ error: "Cấu hình máy chủ không hợp lệ: Thiếu JWT_SECRET" });
        return;
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET) as JwtPayload;

        // Kiểm tra token hết hạn
        if (decoded.exp && decoded.exp * 1000 < Date.now()) {
            res.status(401).json({ error: "Token đã hết hạn" });
            return;
        }

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