import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Interface cho dữ liệu trong JWT
interface JwtPayload {
    id: string;
    username: string;
    // Thêm các trường khác nếu cần
}

// Interface mở rộng Request
interface AuthenticatedRequest extends Request {
    user?: JwtPayload;
}

export function authMiddleware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): void {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        res.status(401).json({ error: "No token" });
        return;
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret") as JwtPayload;
        req.user = decoded;
        next();
    } catch {
        res.status(401).json({ error: "Invalid token" });
        return;
    }
}