import express, { Request, Response, NextFunction } from "express";
import Package from "../models/Package";
import { authMiddleware, adminMiddleware } from "../middleware/auth";

const router = express.Router();
interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string; role: string };
}
// Ensure index on name field in Package schema
// Add to schema: Package.index({ name: 1 }, { unique: true });

router.get("/", async (_req: Request, res: Response) => {
    try {
        const packages = await Package.find().lean();
        res.json(packages);
    } catch (error: any) {
        console.error("❌ Lỗi lấy danh sách gói:", error.message);
        res.status(500).json({ error: "Không thể lấy danh sách gói", detail: error.message });
    }
});

router.post("/", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { name, maxPages, price, customizable } = req.body;
        if (!name || !maxPages || price === undefined) {
            res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
            return
        }
        if (maxPages <= 0 || price < 0) {
            res.status(400).json({ error: "maxPages phải lớn hơn 0 và price không được âm" });
            return
        }
        const pkg = await Package.create({ name, maxPages, price, customizable });
        res.status(201).json(pkg);
    } catch (error: any) {
        console.error("❌ Lỗi tạo gói:", error.message);
        if (error.code === 11000) {
            res.status(400).json({ error: "Tên gói đã tồn tại" });
        } else {
            res.status(500).json({ error: "Không thể tạo gói", detail: error.message });
        }
    }
});

router.put("/:id", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { name, maxPages, price, customizable } = req.body;
        if (!name || !maxPages || price === undefined) {
            res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
            return
        }
        if (maxPages <= 0 || price < 0) {
            res.status(400).json({ error: "maxPages phải lớn hơn 0 và price không được âm" });
            return
        }
        const pkg = await Package.findByIdAndUpdate(
            id,
            { name, maxPages, price, customizable },
            { new: true, runValidators: true }
        );
        if (!pkg) res.status(404).json({ error: "Không tìm thấy gói" });
        return
        res.json(pkg);
    } catch (error: any) {
        console.error("❌ Lỗi cập nhật gói:", error.message);
        if (error.code === 11000) {
            res.status(400).json({ error: "Tên gói đã tồn tại" });
        } else {
            res.status(500).json({ error: "Không thể cập nhật gói", detail: error.message });
        }
    }
});

router.delete("/:id", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const pkg = await Package.findByIdAndDelete(id);
        if (!pkg)
            res.status(404).json({ error: "Không tìm thấy gói" });
        return
        res.json({ success: true });
    } catch (error: any) {
        console.error("❌ Lỗi xóa gói:", error.message);
        res.status(500).json({ error: "Không thể xóa gói", detail: error.message });
    }
});

export default router;