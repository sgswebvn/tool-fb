import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User"; // Import User model để lấy thông tin role

interface JwtPayload {
    id: string;
    username: string;
    iat?: number;
    exp?: number;
}

interface AuthenticatedRequest extends Request {
    user?: JwtPayload & { role: string }; // Thêm role vào interface
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

        // Lấy thông tin người dùng từ database để lấy role
        User.findById(decoded.id)
            .then((user) => {
                if (!user) {
                    res.status(401).json({ error: "Người dùng không tồn tại" });
                    return;
                }
                req.user = {
                    id: decoded.id,
                    username: decoded.username,
                    role: user.role, // Gán role từ database
                };
                next();
            })
            .catch((err) => {
                res.status(500).json({ error: "Lỗi truy vấn người dùng", detail: err.message });
            });
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