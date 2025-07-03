import express, { Request, Response, NextFunction } from "express";
import Package from "../models/Package";
import { authMiddleware, adminMiddleware } from "../middleware/auth";

const router = express.Router();

router.get("/", async (_req: Request, res: Response) => {
    try {
        const packages = await Package.find();
        res.json(packages);
    } catch (error) {
        res.status(500).json({ error: "Không thể lấy danh sách gói" });
    }
});

// Tạo mới một gói (admin)
router.post("/", authMiddleware, adminMiddleware, (req: Request, res: Response, next: NextFunction) => {
    (async () => {
        try {
            const { name, maxPages, price, customizable } = req.body;
            if (!name || !maxPages || price === undefined) {
                return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
            }
            const pkg = await Package.create({ name, maxPages, price, customizable });
            res.status(201).json(pkg);
        } catch (error: any) {
            if (error.code === 11000) {
                res.status(400).json({ error: "Tên gói đã tồn tại" });
            } else {
                res.status(500).json({ error: "Không thể tạo gói" });
            }
        }
    })().catch(next);
});

// Cập nhật một gói (admin)
router.put("/:id", authMiddleware, adminMiddleware, (req: Request, res: Response, next: NextFunction) => {
    (async () => {
        try {
            const { id } = req.params;
            const { name, maxPages, price, customizable } = req.body;
            const pkg = await Package.findByIdAndUpdate(
                id,
                { name, maxPages, price, customizable },
                { new: true, runValidators: true }
            );
            if (!pkg) return res.status(404).json({ error: "Không tìm thấy gói" });
            res.json(pkg);
        } catch (error: any) {
            if (error.code === 11000) {
                res.status(400).json({ error: "Tên gói đã tồn tại" });
            } else {
                res.status(500).json({ error: "Không thể cập nhật gói" });
            }
        }
    })().catch(next);
});

// Xoá một gói (admin)
router.delete("/:id", authMiddleware, adminMiddleware, (req: Request, res: Response, next: NextFunction) => {
    (async () => {
        try {
            const { id } = req.params;
            const pkg = await Package.findByIdAndDelete(id);
            if (!pkg) return res.status(404).json({ error: "Không tìm thấy gói" });
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: "Không thể xoá gói" });
        }
    })().catch(next);
});

export default router;
