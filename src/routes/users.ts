import express, { Request, Response, NextFunction } from "express";
import User from "../models/User";
import { authMiddleware, adminMiddleware } from "../middleware/auth";

const router = express.Router();

// Lấy danh sách tất cả user (admin)
router.get("/", authMiddleware, adminMiddleware, async (_req: Request, res: Response) => {
    try {
        const users = await User.find({}, "_id email name role isActive");
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: "Không thể lấy danh sách người dùng" });
    }
});

// Khoá user (admin)
router.put("/:id/lock", authMiddleware, adminMiddleware, (req: Request, res: Response, next: NextFunction) => {
    (async () => {
        try {
            const { id } = req.params;
            const user = await User.findByIdAndUpdate(id, { isActive: false }, { new: true });
            if (!user) return res.status(404).json({ error: "Không tìm thấy người dùng" });
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: "Không thể khoá người dùng" });
        }
    })().catch(next);
});

// Mở khoá user (admin)
router.put("/:id/unlock", authMiddleware, adminMiddleware, (req: Request, res: Response, next: NextFunction) => {
    (async () => {
        try {
            const { id } = req.params;
            const user = await User.findByIdAndUpdate(id, { isActive: true }, { new: true });
            if (!user) return res.status(404).json({ error: "Không tìm thấy người dùng" });
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: "Không thể mở khoá người dùng" });
        }
    })().catch(next);
});

export default router;
