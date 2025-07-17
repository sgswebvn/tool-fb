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

// Delay function to avoid API rate limiting
async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Get posts for a page
router.get("/:pageId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { pageId } = req.params;
        const { limit = 10, skip = 0 } = req.query;

        if (!pageId || !/^[0-9_]+$/.test(pageId)) {
            res.status(400).json({ error: "pageId không hợp lệ" });
            return;
        }

        const user = await User.findById(req.user?.id);
        if (!user || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
            return;
        }

        const page = await Page.findOne({ pageId, facebookId: user.facebookId });
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền" });
            return;
        }

        // Check if token is expired
        if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
            await Page.updateOne({ pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
            return;
        }

        // Fetch posts from Facebook
        let allPosts: FacebookPost[] = [];
        let url = `https://graph.facebook.com/v18.0/${pageId}/posts?access_token=${page.access_token}&fields=id,message,created_time,full_picture,likes.summary(true),shares&limit=50`;

        while (url) {
            try {
                const { data } = await axios.get(url);
                if (!data.data) break;
                allPosts = [...allPosts, ...data.data];
                url = data.paging?.next || "";
                if (url) await delay(500);
            } catch (error: any) {
                console.error(`Lỗi khi lấy bài đăng cho page ${pageId}:`, error?.response?.data?.error || error.message);
                throw error;
            }
        }

        // Save or update posts in database
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

        // Retrieve posts from database with pagination
        const posts = await Post.find({ pageId })
            .sort({ created_time: -1 })
            .limit(Number(limit))
            .skip(Number(skip))
            .lean();

        res.json(posts);
    } catch (error: any) {
        console.error("❌ Lỗi khi lấy bài đăng từ Facebook:", error?.response?.data?.error || error.message);
        const errorCode = error?.response?.data?.error?.code;
        const { pageId } = req.params;
        if (errorCode === 190) {
            await Page.updateOne({ pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau." });
        } else {
            res.status(500).json({ error: "Không thể lấy bài đăng từ Facebook", detail: error.message });
        }
    }
});

export default router;