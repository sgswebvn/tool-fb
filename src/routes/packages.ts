import express, { Request, Response } from "express";
import Redis from "ioredis";
import Package from "../models/Package";
import { authMiddleware, adminMiddleware } from "../middleware/auth";
import winston from "winston";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string; role: string };
}

const router = express.Router();

/**
 * Get all packages
 * @route GET /packages
 */
router.get("/", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;

    try {
        const cacheKey = "packages:all";
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        const packages = await Package.find().lean();
        await redis.setex(cacheKey, 3600, JSON.stringify(packages)); // Cache for 1 hour

        logger.info("Packages fetched", { userId: req.user?.id, count: packages.length });
        res.json(packages);
    } catch (error: any) {
        logger.error("Error fetching packages", { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: "Không thể lấy danh sách gói", detail: error.message });
    }
});

/**
 * Get package by ID
 * @route GET /packages/:id
 */
router.get("/:id", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { id } = req.params;

    try {
        const cacheKey = `package:${id}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        const pkg = await Package.findById(id).lean();
        if (!pkg) {
            res.status(404).json({ error: "Không tìm thấy gói" });
            return;
        }

        await redis.setex(cacheKey, 3600, JSON.stringify(pkg)); // Cache for 1 hour
        logger.info("Package fetched", { packageId: id, userId: req.user?.id });
        res.json(pkg);
    } catch (error: any) {
        logger.error("Error fetching package", { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: "Không thể lấy thông tin gói", detail: error.message });
    }
});

/**
 * Create new package (admin only)
 * @route POST /packages
 * @body {name, maxPages, price, customizable, description, duration}
 */
router.post("/", [authMiddleware, adminMiddleware], async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { name, maxPages, price, customizable, description, duration } = req.body;

    try {
        if (!name || !maxPages || price == null) {
            res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
            return;
        }

        const pkg = new Package({ name, maxPages, price, customizable, description, duration });
        await pkg.save();

        await redis.del("packages:all"); // Invalidate cache
        logger.info("Package created", { packageId: pkg._id, userId: req.user?.id });
        res.status(201).json(pkg);
    } catch (error: any) {
        logger.error("Error creating package", { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: "Không thể tạo gói", detail: error.message });
    }
});

/**
 * Update package (admin only)
 * @route PUT /packages/:id
 * @body {name, maxPages, price, customizable, description, duration}
 */
router.put("/:id", [authMiddleware, adminMiddleware], async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { id } = req.params;
    const { name, maxPages, price, customizable, description, duration } = req.body;

    try {
        const pkg = await Package.findById(id);
        if (!pkg) {
            res.status(404).json({ error: "Không tìm thấy gói" });
            return;
        }

        pkg.name = name || pkg.name;
        pkg.maxPages = maxPages || pkg.maxPages;
        pkg.price = price != null ? price : pkg.price;
        pkg.customizable = customizable != null ? customizable : pkg.customizable;
        pkg.description = description || pkg.description;
        pkg.duration = duration || pkg.duration;
        await pkg.save();

        await redis.del(`package:${id}`);
        await redis.del("packages:all"); // Invalidate cache
        logger.info("Package updated", { packageId: id, userId: req.user?.id });
        res.json(pkg);
    } catch (error: any) {
        logger.error("Error updating package", { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: "Không thể cập nhật gói", detail: error.message });
    }
});

export default router;