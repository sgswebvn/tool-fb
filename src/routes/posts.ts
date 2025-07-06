import express, { Request, Response } from "express";
import axios from "axios";
import Page from "../models/Page";
import Post from "../models/Post";
import Comment from "../models/Comment";

// Định nghĩa interface cho req.params
interface PostParams {
    pageId: string;
    postId?: string; // postId là tùy chọn vì không xuất hiện trong route /:pageId
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
}

const router = express.Router();

// Lấy post của page
router.get("/:pageId", async (req: Request<PostParams>, res: Response): Promise<void> => {
    try {
        const { pageId } = req.params;
        if (!pageId) {
            res.status(400).json({ error: "Thiếu pageId" });
            return;
        }

        const page = await Page.findOne({ pageId });
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page" });
            return;
        }

        const { data } = await axios.get<{ data: FacebookPost[] }>(
            `https://graph.facebook.com/v18.0/${pageId}/posts`,
            { params: { access_token: page.access_token, fields: "id,message,created_time" } }
        );

        for (const post of data.data) {
            await Post.updateOne(
                { postId: post.id },
                { pageId, postId: post.id, message: post.message, created_time: post.created_time },
                { upsert: true }
            );
        }

        res.json(data.data);
    } catch (error) {
        console.error("❌ Lỗi khi lấy bài đăng từ Facebook:", error);
        res.status(500).json({ error: "Không thể lấy bài đăng từ Facebook" });
    }
});

// Lấy comment của post
router.get("/:pageId/:postId/comments", async (req: Request<PostParams>, res: Response): Promise<void> => {
    try {
        const { pageId, postId } = req.params;
        if (!pageId || !postId) {
            res.status(400).json({ error: "Thiếu pageId hoặc postId" });
            return;
        }

        const page = await Page.findOne({ pageId });
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page" });
            return;
        }
        const access_token = page.access_token;
        // Hàm đệ quy lấy tất cả comment và reply, có giới hạn depth
        async function fetchComments(fbPostId: string, parentId: string | null = null, depth = 0) {
            if (depth > 5) return; // tránh lặp vô hạn
            const { data } = await axios.get<{ data: FacebookComment[] }>(
                `https://graph.facebook.com/v18.0/${fbPostId}/comments`,
                { params: { access_token, fields: "id,message,from,created_time", filter: "stream" } }
            );
            for (const cmt of data.data) {
                await Comment.updateOne(
                    { commentId: cmt.id },
                    { postId, commentId: cmt.id, message: cmt.message, from: cmt.from.name, created_time: cmt.created_time, parent_id: parentId || null },
                    { upsert: true }
                );
                // Lấy reply cho comment này nếu có
                const replyRes = await axios.get<{ data: FacebookComment[] }>(
                    `https://graph.facebook.com/v18.0/${cmt.id}/comments`,
                    { params: { access_token, fields: "id,message,from,created_time", filter: "stream" } }
                );
                if (replyRes.data.data.length > 0) {
                    await fetchComments(cmt.id, cmt.id, depth + 1);
                }
            }
        }
        await fetchComments(postId, null, 0);
        // Trả về tất cả comment của postId
        const comments = await Comment.find({ postId }).sort({ created_time: 1 });
        res.json(comments);
    } catch (error) {
        console.error("❌ Lỗi khi lấy bình luận từ Facebook:", error);
        res.status(500).json({ error: "Không thể lấy bình luận từ Facebook" });
    }
});

export default router;