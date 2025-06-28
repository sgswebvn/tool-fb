import express from "express";
import Page from "../models/Page";
import User from "../models/User";
import { Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string };
}

interface ConnectPageRequestBody {
    pageId: string;
    name: string;
    access_token: string;
}

const router = express.Router();

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: "Không tìm thấy thông tin người dùng" });
            return;
        }
        const user = await User.findById(userId);
        if (!user || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
            return;
        }
        const pages = await Page.find({ facebookId: user.facebookId, connected: true });
        res.json(pages.map(page => ({
            pageId: page.pageId,
            name: page.name,
            connected: true,
        })));
    } catch (error) {
        res.status(500).json({ error: "Không thể lấy danh sách trang" });
    }
});

router.post("/connect", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        const { pageId, name, access_token } = req.body as ConnectPageRequestBody;
        if (!userId || !pageId || !name || !access_token) {
            res.status(400).json({ error: "Thiếu thông tin cần thiết" });
            return;
        }
        const user = await User.findById(userId);
        if (!user || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
            return;
        }
        // Xóa các Fanpage cũ của cùng facebookId (chỉ cho phép 1 Fanpage)
        await Page.deleteMany({ facebookId: user.facebookId });
        // Lưu Fanpage mới
        await Page.create({
            facebookId: user.facebookId,
            pageId,
            name,
            access_token,
            expires_in: 5184000, // 60 ngày mặc định
            connected_at: new Date(),
            connected: true,
        });
        // Xóa facebookAccessToken tạm thời
        await User.updateOne({ _id: userId }, { $unset: { facebookAccessToken: "" } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Không thể kết nối Fanpage" });
    }
});

export default router;