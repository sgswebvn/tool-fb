import express from "express";
import Page from "../models/Page";
import User from "../models/User";
import Package from "../models/Package";
import { Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import axios from "axios";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string };
}

interface ConnectPageRequestBody {
    pageId: string;
    name: string;
    access_token: string;
}

const router = express.Router();

// Lấy danh sách page đã kết nối
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
        const pages = await Page.find({ facebookId: user.facebookId });
        res.json(pages.map(page => ({
            pageId: page.pageId,
            name: page.name,
            connected: page.connected,
        })));
    } catch (error) {
        res.status(500).json({ error: "Không thể lấy danh sách trang" });
    }
});
// pages.ts
router.post("/connect", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
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
        const userPackage = await Package.findOne({ name: user.package || "free" });
        const maxPages = userPackage ? userPackage.maxPages : 1;
        const pageCount = await Page.countDocuments({ facebookId: user.facebookId });
        if (pageCount >= maxPages) {
            res.status(403).json({ error: `Bạn đã đạt giới hạn số fanpage (${maxPages}). Vui lòng nâng cấp gói để kết nối thêm.` });
            return;
        }
        let page = await Page.findOne({ facebookId: user.facebookId, pageId });
        if (!page) {
            page = new Page({
                facebookId: user.facebookId,
                pageId,
                name,
                access_token,
                expires_in: 5184000,
                connected_at: new Date(),
                connected: true,
                picture: (await axios.get(`https://graph.facebook.com/${pageId}?fields=picture&access_token=${access_token}`)).data.picture?.data?.url,
            });
        } else {
            page.name = name;
            page.access_token = access_token;
            page.connected_at = new Date();
            page.connected = true;
            page.picture = (await axios.get(`https://graph.facebook.com/${pageId}?fields=picture&access_token=${access_token}`)).data.picture?.data?.url;
        }
        await page.save();
        res.json({ success: true, pageId: page.pageId });
    } catch (error) {
        res.status(500).json({ error: "Không thể kết nối Fanpage" });
    }
});

// Lấy thông tin chi tiết 1 page
// posts.ts
router.get("/:pageId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { pageId } = req.params;
        const userId = req.user?.id;
        if (!pageId || !userId) {
            res.status(400).json({ error: "Thiếu pageId hoặc thông tin người dùng" });
            return;
        }
        const user = await User.findById(userId);
        if (!user || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
            return;
        }
        const page = await Page.findOne({ pageId, facebookId: user.facebookId });
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền" });
            return;
        }
    } catch (error) {
        res.status(500).json({ error: "Không thể lấy bài đăng từ Facebook" });
    }
});

// Xóa 1 page
router.delete("/:pageId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        const { pageId } = req.params;
        const user = await User.findById(userId);
        if (!user || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
            return;
        }
        await Page.deleteOne({ facebookId: user.facebookId, pageId });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Không thể xóa page" });
    }
});

export default router;