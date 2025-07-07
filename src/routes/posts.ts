import express, { Request, Response } from "express";
import axios from "axios";
import Page from "../models/Page";
import Post from "../models/Post";
import Comment from "../models/Comment";
import User from "../models/User";
import { authMiddleware } from "../middleware/auth";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string };
}

// Định nghĩa interface cho req.params
interface PostParams {
    pageId: string;
    postId?: string;
}

// Định nghĩa interface cho dữ liệu từ Facebook API
interface FacebookPost {
    id: string;
    message?: string;
    created_time: string;
}

interface FacebookComment {
    id: string;
    message: string;
    from: { name: string };
    created_time: string;
    parent?: { id: string };
}

const router = express.Router();

// Lấy post của page
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
        if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
            await Page.updateOne({ pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
            return;
        }
        const { data } = await axios.get<{ data: FacebookPost[] }>(
            `https://graph.facebook.com/v18.0/${pageId}/posts`,
            { params: { access_token: page.access_token, fields: "id,message,created_time" } }
        );
        await Promise.all(
            data.data.map(post =>
                Post.updateOne(
                    { postId: post.id },
                    { pageId, postId: post.id, message: post.message, created_time: post.created_time },
                    { upsert: true }
                )
            )
        );
        res.json(data.data);
    } catch (error: any) {
        console.error("❌ Lỗi khi lấy bài đăng từ Facebook:", error);
        const errorMessage = error.response?.data?.error?.message || "Không thể lấy bài đăng từ Facebook";
        const errorCode = error.response?.data?.error?.code;
        if (errorCode === 190) {
            await Page.updateOne({ pageId }, { connected: false });
            res.status(400).json({
                error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook.",
                detail: errorMessage,
            });
        } else if (errorCode === 4) {
            res.status(429).json({
                error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau.",
                detail: errorMessage,
            });
        } else if (errorCode === 200) {
            res.status(403).json({
                error: "Quyền truy cập không đủ hoặc token không hợp lệ.",
                detail: errorMessage,
            });
        } else {
            res.status(500).json({ error: errorMessage, detail: error.message });
        }
    }
});

// Lấy comment của post
router.get("/:pageId/:postId/comments", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { pageId, postId } = req.params;
        const userId = req.user?.id;
        if (!pageId || !postId || !userId) {
            res.status(400).json({ error: "Thiếu pageId, postId hoặc thông tin người dùng" });
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
        if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
            await Page.updateOne({ pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
            return;
        }
        const { data } = await axios.get<{ data: FacebookComment[] }>(
            `https://graph.facebook.com/v18.0/${postId}/comments`,
            { params: { access_token: page.access_token, fields: "id,message,from,created_time,parent" } }
        );
        await Promise.all(
            data.data.map(cmt => {
                if (!cmt.parent || cmt.parent.id === postId) {
                    return Comment.updateOne(
                        { commentId: cmt.id },
                        {
                            postId,
                            commentId: cmt.id,
                            message: cmt.message,
                            from: cmt.from?.name || "Fanpage",
                            created_time: cmt.created_time,
                            parent_id: cmt.parent?.id || null
                        },
                        { upsert: true }
                    );
                }
                return Promise.resolve();
            })
        );
        const comments = await Comment.find({ postId }).sort({ created_time: 1 });
        res.json(comments);
    } catch (error: any) {
        console.error("❌ Lỗi khi lấy bình luận từ Facebook:", error);
        const errorMessage = error.response?.data?.error?.message || "Không thể lấy bình luận từ Facebook";
        const errorCode = error.response?.data?.error?.code;
        if (errorCode === 190) {
            await Page.updateOne({ pageId }, { connected: false });
            res.status(400).json({
                error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook.",
                detail: errorMessage,
            });
        } else if (errorCode === 4) {
            res.status(429).json({
                error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau.",
                detail: errorMessage,
            });
        } else if (errorCode === 200) {
            res.status(403).json({
                error: "Quyền truy cập không đủ hoặc token không hợp lệ.",
                detail: errorMessage,
            });
        } else {
            res.status(500).json({ error: errorMessage, detail: error.message });
        }
    }
});

export default router;

git add . 
git commit -m "Fix: Handle errors in posts and comments routes, ensure proper error responses"
git push origin main