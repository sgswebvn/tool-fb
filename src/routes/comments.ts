import express, { Request, Response } from "express";
import Comment from "../models/Comment";
import Post from "../models/Post";
import Page from "../models/Page";
import axios from "axios";

const router = express.Router();

router.get("/:postId", async (req: Request<{ postId: string }>, res: Response): Promise<void> => {
    try {
        const { postId } = req.params;
        const { limit = 10, skip = 0 } = req.query; // Thêm phân trang
        if (!postId) {
            res.status(400).json({ error: "Thiếu postId" });
            return;
        }
        const comments = await Comment.find({ postId })
            .sort({ created_time: 1 })
            .limit(Number(limit))
            .skip(Number(skip))
            .lean();
        res.json(comments);
    } catch (error) {
        res.status(500).json({ error: "Lỗi máy chủ" });
    }
});

// Tạo comment mới hoặc reply
router.post("/:postId", async (req: Request<{ postId: string }, any, { message: string; parentId?: string; from?: string }>, res: Response): Promise<void> => {
    try {
        const { postId } = req.params;
        const { message, parentId, from } = req.body;
        if (!postId || !message) {
            res.status(400).json({ error: "Thiếu thông tin" });
            return;
        }
        // Lấy post và page để lấy access_token
        const post = await Post.findOne({ postId });
        if (!post) {
            res.status(404).json({ error: "Không tìm thấy post" });
            return;
        }
        const page = await Page.findOne({ pageId: post.pageId });
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page" });
            return;
        }
        // Gửi comment lên Facebook
        let fbRes;
        if (!parentId) {
            // Bình luận mới cho post
            fbRes = await axios.post(`https://graph.facebook.com/v18.0/${postId}/comments`, {
                message
            }, {
                params: { access_token: page.access_token }
            });
        } else {
            // Reply cho comment
            fbRes = await axios.post(`https://graph.facebook.com/v18.0/${parentId}/comments`, {
                message
            }, {
                params: { access_token: page.access_token }
            });
        }
        // Lưu comment vào DB
        const fbCommentId = fbRes.data.id;
        const comment = new Comment({
            postId,
            commentId: fbCommentId,
            message,
            from: from || page.name || "Fanpage",
            created_time: new Date().toISOString(),
            parent_id: parentId || null,
            facebookId: page.facebookId
        });
        await comment.save();
        res.json(comment);
    } catch (error) {
        res.status(500).json({ error: "Không thể tạo comment trên Facebook" });
    }
});

export default router;