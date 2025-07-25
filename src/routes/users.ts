import express, { Request, Response } from "express";
import Redis from "ioredis";
import User from "../models/User";
import Package from "../models/Package";
import Page from "../models/Page";
import { authMiddleware, adminMiddleware } from "../middleware/auth";
import winston from "winston";
import validator from "validator";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string; role: string };
}

interface UpdateUserBody {
    email?: string;
    name?: string;
    role?: "admin" | "user" | "guest";
    isActive?: boolean;
}

const router = express.Router();

/**
 * Get all users (admin only)
 * @route GET /users
 */
router.get("/", [authMiddleware, adminMiddleware], async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;

    try {
        const cacheKey = "users:all";
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        const users = await User.find().select("-password -facebookAccessToken").lean();
        await redis.setex(cacheKey, 3600, JSON.stringify(users)); // Cache for 1 hour

        logger.info("Users fetched", { userId: req.user?.id, count: users.length });
        res.json(users);
    } catch (error: any) {
        logger.error("Error fetching users", { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: "Không thể lấy danh sách người dùng", detail: error.message });
    }
});

/**
 * Get user by ID
 * @route GET /users/:id
 */
router.get("/:id", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { id } = req.params;

    try {
        if (req.user?.id !== id && req.user?.role !== "admin") {
            res.status(403).json({ error: "Không có quyền truy cập" });
            return;
        }

        const cacheKey = `user:${id}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        const user = await User.findById(id).select("-password -facebookAccessToken").lean();
        if (!user) {
            res.status(404).json({ error: "Không tìm thấy người dùng" });
            return;
        }

        await redis.setex(cacheKey, 3600, JSON.stringify(user)); // Cache for 1 hour
        logger.info("User fetched", { userId: id, requesterId: req.user?.id });
        res.json(user);
    } catch (error: any) {
        logger.error("Error fetching user", { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: "Không thể lấy thông tin người dùng", detail: error.message });
    }
});

/**
 * Update user (admin or self)
 * @route PUT /users/:id
 * @body {email, name, role, isActive}
 */
router.put("/:id", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { id } = req.params;
    const { email, name, role, isActive } = req.body as UpdateUserBody;

    try {
        if (req.user?.id !== id && req.user?.role !== "admin") {
            res.status(403).json({ error: "Không có quyền cập nhật" });
            return;
        }

        const user = await User.findById(id);
        if (!user) {
            res.status(404).json({ error: "Không tìm thấy người dùng" });
            return;
        }

        if (email && !validator.isEmail(email)) {
            res.status(400).json({ error: "Email không hợp lệ" });
            return;
        }

        if (email) user.email = email;
        if (name) user.name = name;
        if (req.user?.role === "admin") {
            if (role && ["admin", "user", "guest"].includes(role)) user.role = role;
            if (isActive != null) user.isActive = isActive;
        }

        await user.save();

        await redis.del(`user:${id}`);
        await redis.del("users:all"); // Invalidate cache
        logger.info("User updated", { userId: id, requesterId: req.user?.id });
        res.json({ success: true, user: user.toJSON() });
    } catch (error: any) {
        logger.error("Error updating user", { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: "Không thể cập nhật người dùng", detail: error.message });
    }
});

/**
 * Delete user (admin only)
 * @route DELETE /users/:id
 */
router.delete("/:id", [authMiddleware, adminMiddleware], async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { id } = req.params;

    try {
        const user = await User.findByIdAndDelete(id);
        if (!user) {
            res.status(404).json({ error: "Không tìm thấy người dùng" });
            return;
        }

        await redis.del(`user:${id}`);
        await redis.del("users:all"); // Invalidate cache
        logger.info("User deleted", { userId: id, requesterId: req.user?.id });
        res.json({ success: true });
    } catch (error: any) {
        logger.error("Error deleting user", { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: "Không thể xóa người dùng", detail: error.message });
    }
});

export default router;