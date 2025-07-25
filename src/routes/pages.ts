import express, { Request, Response } from "express";
import Redis from "ioredis";
import Page from "../models/Page";
import User from "../models/User";
import Package from "../models/Package";
import { authMiddleware } from "../middleware/auth";
import winston from "winston";
import { getFacebookPages, refreshAccessToken } from "../services/facebook";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string; role: string };
}

const router = express.Router();

/**
 * Get all connected pages
 * @route GET /pages
 */
router.get("/", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const userId = req.user?.id;

    try {
        const cacheKey = `pages:${userId}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        const user = await User.findById(userId).lean();
        if (!user || !user.isActive || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
            return;
        }

        const pages = await Page.find({ facebookId: user.facebookId }).lean();
        await redis.setex(cacheKey, 3600, JSON.stringify(pages)); // Cache for 1 hour

        logger.info("Pages fetched", { userId, count: pages.length });
        res.json(pages);
    } catch (error: any) {
        logger.error("Error fetching pages", { error: error.message, userId });
        res.status(500).json({ error: "Không thể lấy danh sách trang", detail: error.message });
    }
});

/**
 * Connect new page
 * @route POST /pages/connect
 * @body {accessToken}
 */
router.post("/connect", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { accessToken } = req.body;
    const userId = req.user?.id;

    try {
        if (!accessToken) {
            res.status(400).json({ error: "Thiếu accessToken" });
            return;
        }

        const user = await User.findById(userId);
        if (!user || !user.isActive) {
            res.status(404).json({ error: "Người dùng không tồn tại hoặc bị khóa" });
            return;
        }

        const pkg = await Package.findOne({ name: user.package }).lean();
        if (!pkg) {
            res.status(400).json({ error: "Gói dịch vụ không hợp lệ" });
            return;
        }

        const pageCount = await Page.countDocuments({ facebookId: user.facebookId });
        if (pageCount >= pkg.maxPages) {
            res.status(403).json({ error: `Đã đạt giới hạn ${pkg.maxPages} trang. Vui lòng nâng cấp gói.` });
            return;
        }

        const fbPages = await getFacebookPages(accessToken, redis);
        const bulkOps = fbPages.map(page => ({
            updateOne: {
                filter: { pageId: page.id, facebookId: user.facebookId },
                update: {
                    pageId: page.id,
                    facebookId: user.facebookId,
                    name: page.name,
                    access_token: page.access_token,
                    expires_in: 5184000, // Default 60 days
                    connected: true,
                    connected_at: new Date()
                },
                upsert: true
            }
        }));

        if (bulkOps.length > 0) {
            await Page.bulkWrite(bulkOps);
            await redis.del(`pages:${userId}`); // Invalidate cache
        }

        const pages = await Page.find({ facebookId: user.facebookId }).lean();
        logger.info("Pages connected", { userId, count: bulkOps.length });
        res.json(pages);
    } catch (error: any) {
        logger.error("Error connecting pages", { error: error.message, userId });
        res.status(500).json({ error: "Không thể kết nối trang", detail: error.message });
    }
});

/**
 * Refresh page access token
 * @route POST /pages/:pageId/refresh
 */
router.post("/:pageId/refresh", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { pageId } = req.params;
    const userId = req.user?.id;

    try {
        if (!pageId || !/^[0-9_]+$/.test(pageId)) {
            res.status(400).json({ error: "pageId không hợp lệ" });
            return;
        }

        const user = await User.findById(userId).lean();
        if (!user || !user.isActive || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
            return;
        }

        const page = await refreshAccessToken(pageId);
        await redis.del(`pages:${userId}`); // Invalidate cache

        logger.info("Page token refreshed", { pageId, userId });
        res.json(page);
    } catch (error: any) {
        logger.error("Error refreshing page token", { error: error.message, userId });
        res.status(500).json({ error: "Không thể làm mới token", detail: error.message });
    }
});

/**
 * Disconnect page
 * @route DELETE /pages/:pageId
 */
router.delete("/:pageId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { pageId } = req.params;
    const userId = req.user?.id;

    try {
        if (!pageId || !/^[0-9_]+$/.test(pageId)) {
            res.status(400).json({ error: "pageId không hợp lệ" });
            return;
        }

        const user = await User.findById(userId).lean();
        if (!user || !user.isActive || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
            return;
        }

        const page = await Page.findOneAndDelete({ pageId, facebookId: user.facebookId });
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy trang hoặc bạn không có quyền" });
            return;
        }

        await redis.del(`pages:${userId}`); // Invalidate cache
        logger.info("Page disconnected", { pageId, userId });
        res.json({ success: true });
    } catch (error: any) {
        logger.error("Error disconnecting page", { error: error.message, userId });
        res.status(500).json({ error: "Không thể ngắt kết nối trang", detail: error.message });
    }
});

export default router;