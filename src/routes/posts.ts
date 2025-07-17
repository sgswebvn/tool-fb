import express, { Request, Response } from "express";
import axios from "axios";
import Page from "../models/Page";
import Post from "../models/Post";
import { authMiddleware } from "../middleware/auth";
import User from "../models/User";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string; role: string };
}

interface FacebookPost {
    id: string;
    message?: string;
    created_time: string;
    full_picture?: string;
    likes?: { summary: { total_count: number } };
    shares?: { count: number };
}

const router = express.Router();

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

router.get("/:pageId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { pageId } = req.params;
        const { limit = 10, skip = 0 } = req.query;

        if (!pageId || !/^[0-9_]+$/.test(pageId)) {
            res.status(400).json({ error: "pageId không hợp lệ" });
            return;
        }

        const user = await User.findById(req.user?.id).lean();
        if (!user || !user.isActive || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
            return;
        }

        const page = await Page.findOne({ pageId, facebookId: user.facebookId });
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền" });
            return;
        }

        if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
            await Page.updateOne({ pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
            return;
        }

        let allPosts: FacebookPost[] = [];
        let url = `https://graph.facebook.com/v18.0/${pageId}/posts?access_token=${page.access_token}&fields=id,message,created_time,full_picture,likes.summary(true),shares&limit=50`;
        let pageCount = 0;
        const maxPages = 5; // Limit API calls to avoid rate limit

        while (url && pageCount < maxPages) {
            try {
                const { data } = await axios.get(url);
                if (!Array.isArray(data.data)) {
                    throw new Error("Dữ liệu bài đăng không hợp lệ từ Facebook");
                }
                allPosts = [...allPosts, ...data.data];
                url = data.paging?.next || "";
                pageCount++;
                if (url) await delay(500);
            } catch (error: any) {
                console.error(`Lỗi khi lấy bài đăng cho page ${pageId}:`, error?.response?.data?.error || error.message);
                throw error;
            }
        }

        const bulkOps = allPosts.map(post => ({
            updateOne: {
                filter: { postId: post.id },
                update: {
                    pageId,
                    postId: post.id,
                    message: post.message || "",
                    created_time: new Date(post.created_time),
                    picture: post.full_picture || null,
                    likes: post.likes?.summary?.total_count || 0,
                    shares: post.shares?.count || 0,
                },
                upsert: true,
            },
        }));

        if (bulkOps.length > 0) {
            await Post.bulkWrite(bulkOps);
        }

        const posts = await Post.find({ pageId })
            .sort({ created_time: -1 })
            .limit(Number(limit))
            .skip(Number(skip))
            .lean();

        res.json(posts);
    } catch (error: any) {
        console.error("❌ Lỗi khi lấy bài đăng từ Facebook:", error?.response?.data?.error || error.message);
        const errorCode = error?.response?.data?.error?.code;
        if (errorCode === 190) {
            await Page.updateOne({ pageId: req.params.pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau." });
        } else if (errorCode === 100) {
            res.status(400).json({ error: "Tham số không hợp lệ trong yêu cầu Facebook" });
        } else if (errorCode === 200) {
            res.status(403).json({ error: "Quyền truy cập không đủ hoặc token không hợp lệ" });
        } else {
            res.status(500).json({ error: "Không thể lấy bài đăng từ Facebook", detail: error.message });
        }
    }
});

export default router;