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

const pageIdRegex = /^[0-9_]+$/;

// Cache thông tin package
const packageCache: { [key: string]: any } = {};

async function getPackage(name: string) {
    if (packageCache[name]) {
        return packageCache[name];
    }
    const pkg = await Package.findOne({ name }).lean();
    if (pkg) {
        packageCache[name] = pkg;
        setTimeout(() => delete packageCache[name], 3600 * 1000); // Xóa cache sau 1 giờ
    }
    return pkg;
}

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: "Không tìm thấy thông tin người dùng" });
            return;
        }
        const user = await User.findById(userId).lean();
        if (!user || !user.isActive || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
            return;
        }
        const pages = await Page.find({ facebookId: user.facebookId }).lean();
        res.json(pages.map(page => ({
            pageId: page.pageId,
            name: page.name,
            connected: page.connected,
        })));
    } catch (error: any) {
        console.error("❌ Lỗi lấy danh sách trang:", error.message);
        res.status(500).json({ error: "Không thể lấy danh sách trang", detail: error.message });
    }
});

router.post("/connect", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { pageId, name, access_token } = req.body as ConnectPageRequestBody;
        if (!userId || !pageId || !name || !access_token || !pageIdRegex.test(pageId)) {
            res.status(400).json({ error: "Thiếu thông tin cần thiết hoặc pageId không hợp lệ" });
            return;
        }
        const user = await User.findById(userId).lean();
        if (!user || !user.isActive || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
            return;
        }
        const userPackage = await getPackage(user.package || "free");
        const maxPages = userPackage ? userPackage.maxPages : 1;
        const pageCount = await Page.countDocuments({ facebookId: user.facebookId, connected: true });
        if (pageCount >= maxPages) {
            res.status(403).json({ error: `Bạn đã đạt giới hạn số fanpage (${maxPages}). Vui lòng nâng cấp gói để kết nối thêm.` });
            return;
        }
        let page = await Page.findOne({ facebookId: user.facebookId, pageId });
        let picture: string | null = null;
        try {
            const { data } = await axios.get(`https://graph.facebook.com/${pageId}?fields=picture&access_token=${access_token}`);
            picture = data.picture?.data?.url || null;
        } catch (error: any) {
            console.error(`Lỗi khi lấy ảnh page ${pageId}:`, error?.response?.data?.error || error.message);
        }
        if (!page) {
            page = new Page({
                facebookId: user.facebookId,
                pageId,
                name,
                access_token,
                expires_in: 5184000,
                connected_at: new Date(),
                connected: true,
                picture,
            });
        } else {
            page.name = name;
            page.access_token = access_token;
            page.connected_at = new Date();
            page.connected = true;
            page.picture = picture;
        }
        await page.save();
        res.json({ success: true, pageId: page.pageId });
    } catch (error: any) {
        console.error("❌ Lỗi kết nối page:", error?.response?.data?.error || error.message);
        const errorCode = error?.response?.data?.error?.code;
        if (errorCode === 190) {
            res.status(400).json({ error: "Token không hợp lệ" });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API" });
        } else if (errorCode === 100) {
            res.status(400).json({ error: "Tham số không hợp lệ trong yêu cầu Facebook" });
        } else if (errorCode === 200) {
            res.status(403).json({ error: "Quyền truy cập không đủ hoặc token không hợp lệ" });
        } else {
            res.status(500).json({ error: "Không thể kết nối Fanpage", detail: error.message });
        }
    }
});

router.get("/:pageId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { pageId } = req.params;
        const userId = req.user?.id;
        if (!pageId || !userId || !pageIdRegex.test(pageId)) {
            res.status(400).json({ error: "Thiếu pageId, thông tin người dùng hoặc pageId không hợp lệ" });
            return;
        }
        const user = await User.findById(userId).lean();
        if (!user || !user.isActive || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
            return;
        }
        const page = await Page.findOne({ pageId, facebookId: user.facebookId }).lean();
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền" });
            return;
        }
        res.json(page);
    } catch (error: any) {
        console.error("❌ Lỗi lấy thông tin page:", error.message);
        res.status(500).json({ error: "Không thể lấy thông tin page", detail: error.message });
    }
});

router.delete("/:pageId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        const { pageId } = req.params;
        if (!pageId || !pageIdRegex.test(pageId)) {
            res.status(400).json({ error: "pageId không hợp lệ" });
            return;
        }
        const user = await User.findById(userId).lean();
        if (!user || !user.isActive || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
            return;
        }
        const result = await Page.deleteOne({ facebookId: user.facebookId, pageId });
        if (result.deletedCount === 0) {
            res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền" });
            return;
        }
        res.json({ success: true });
    } catch (error: any) {
        console.error("❌ Lỗi xóa page:", error.message);
        res.status(500).json({ error: "Không thể xóa page", detail: error.message });
    }
});

export default router;