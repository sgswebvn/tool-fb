import express, { Request, Response } from "express";
import Comment from "../models/Comment";
import Post from "../models/Post";
import Page from "../models/Page";
import axios from "axios";
import { authMiddleware } from "../middleware/auth";
import User from "../models/User";

// Định nghĩa AuthenticatedRequest
interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string; role: string };
}

const router = express.Router();

// Regex để phát hiện số điện thoại (Việt Nam: bắt đầu bằng 0 hoặc +84, theo sau là 9-10 chữ số)
const phoneRegex = /(0|\+84)(\d{9,10})\b/;

// Lấy danh sách bình luận
router.get("/:postId", async (req: Request<{ postId: string }>, res: Response): Promise<void> => {
    try {
        const { postId } = req.params;
        const { limit = 10, skip = 0 } = req.query;
        if (!postId || postId === "undefined" || !/^[0-9_]+$/.test(postId)) {
            res.status(400).json({ error: "postId không hợp lệ" });
            return;
        }
        const post = await Post.findOne({ postId });
        if (!post) {
            res.status(404).json({ error: "Không tìm thấy bài đăng" });
            return;
        }
        const comments = await Comment.find({ postId })
            .sort({ created_time: 1 })
            .limit(Number(limit))
            .skip(Number(skip))
            .lean();
        res.json(comments);
    } catch (error) {
        console.error("❌ Lỗi khi lấy bình luận:", error);
        res.status(500).json({ error: "Lỗi máy chủ" });
    }
});

// Tạo bình luận mới hoặc trả lời
router.post("/:postId", async (req: Request<{ postId: string }, any, { message: string; parentId?: string; from?: string }>, res: Response): Promise<void> => {
    try {
        const { postId } = req.params;
        const { message, parentId, from } = req.body;
        if (!postId || !message) {
            res.status(400).json({ error: "Thiếu thông tin" });
            return;
        }
        const post = await Post.findOne({ postId });
        if (!post) {
            res.status(404).json({ error: "Không tìm thấy bài đăng" });
            return;
        }
        const page = await Page.findOne({ pageId: post.pageId });
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page" });
            return;
        }
        let fbRes;
        if (!parentId) {
            fbRes = await axios.post(`https://graph.facebook.com/v18.0/${postId}/comments`, {
                message,
            }, {
                params: { access_token: page.access_token },
            });
        } else {
            fbRes = await axios.post(`https://graph.facebook.com/v18.0/${parentId}/comments`, {
                message,
            }, {
                params: { access_token: page.access_token },
            });
        }
        const fbCommentId = fbRes.data.id;
        const comment = new Comment({
            postId,
            commentId: fbCommentId,
            message,
            from: from || page.name || "Fanpage",
            created_time: new Date().toISOString(),
            parent_id: parentId || null,
            facebookId: page.facebookId,
            hidden: phoneRegex.test(message) ? true : false,
        });
        await comment.save();
        if (phoneRegex.test(message)) {
            await axios.post(`https://graph.facebook.com/v18.0/${fbCommentId}?hide=true`, {}, {
                params: { access_token: page.access_token },
            });
            const io = req.app.get("io");
            if (io) {
                io.to(post.pageId).emit("fb_comment_hidden", { commentId: fbCommentId, hidden: true });
            }
        }
        res.json(comment);
    } catch (error) {
        console.error("❌ Lỗi khi tạo bình luận:", error);
        res.status(500).json({ error: "Không thể tạo bình luận trên Facebook" });
    }
});

// Ẩn/hiện bình luận
router.post("/:commentId/hide", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { commentId } = req.params;
        const { pageId, hide } = req.body;
        const user = await User.findById(req.user?.id);
        if (!user || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
            return;
        }
        const page = await Page.findOne({ pageId, facebookId: user.facebookId });
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page" });
            return;
        }
        const comment = await Comment.findOne({ commentId, pageId });
        if (!comment) {
            res.status(404).json({ error: "Không tìm thấy bình luận" });
            return;
        }
        await axios.post(`https://graph.facebook.com/v18.0/${commentId}?hide=${hide}`, {}, {
            params: { access_token: page.access_token },
        });
        comment.hidden = hide;
        await comment.save();
        const io = req.app.get("io");
        if (io) {
            io.to(pageId).emit("fb_comment_hidden", { commentId, hidden: hide });
        }
        res.json({ success: true, hidden: hide });
    } catch (error: any) {
        console.error("❌ Lỗi khi ẩn/hiện bình luận:", error);
        res.status(500).json({ error: "Không thể ẩn/hiện bình luận", detail: error?.response?.data?.error?.message || error.message });
    }
});

// Ẩn tất cả bình luận chứa số điện thoại
router.post("/:postId/hide-phone", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { postId } = req.params;
        const { pageId } = req.body;
        const user = await User.findById(req.user?.id);
        if (!user || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
            return;
        }
        const page = await Page.findOne({ pageId, facebookId: user.facebookId });
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page" });
            return;
        }
        const comments = await Comment.find({ postId, hidden: false });
        const hiddenComments = [];
        for (const comment of comments) {
            if (phoneRegex.test(comment.message)) {
                await axios.post(`https://graph.facebook.com/v18.0/${comment.commentId}?hide=true`, {}, {
                    params: { access_token: page.access_token },
                });
                comment.hidden = true;
                await comment.save();
                hiddenComments.push(comment.commentId);
                const io = req.app.get("io");
                if (io) {
                    io.to(pageId).emit("fb_comment_hidden", { commentId: comment.commentId, hidden: true });
                }
            }
        }
        res.json({ success: true, hiddenComments });
    } catch (error: any) {
        console.error("❌ Lỗi khi ẩn bình luận chứa số điện thoại:", error);
        res.status(500).json({ error: "Không thể ẩn bình luận chứa số điện thoại", detail: error?.response?.data?.error?.message || error.message });
    }
});

export default router;