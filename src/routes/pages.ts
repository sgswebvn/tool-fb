import express from "express";
import Page from "../models/Page";
import { Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string };
}

const router = express.Router();

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        const pages = await Page.find({ userId });
        res.json(pages);
    } catch (error) {
        res.status(500).json({ error: "Không thể lấy danh sách Fanpage" });
    }
});
router.patch("/:pageId/comments", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { pageId } = req.params;
        const { hideType } = req.body;
        const userId = req.user?.id;

        if (!hideType || !["hide_all", "hide_phone", "show_all"].includes(hideType)) {
            res.status(400).json({ error: "Loại ẩn comment không hợp lệ" });
            return;
        }

        const page = await Page.findOneAndUpdate(
            { pageId, userId },
            { commentHideType: hideType },
            { new: true }
        );

        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền truy cập" });
            return;
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Cập nhật chế độ ẩn comment thất bại" });
    }
});
export default router;