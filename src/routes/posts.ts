import express, { Request, Response } from "express";
import axios from "axios";
import Page from "../models/Page";
import Post from "../models/Post";
import Comment from "../models/Comment";
import { authMiddleware } from "../middleware/auth";
import User from "../models/User";

// Define interface for req.params
interface PostParams {
    pageId: string;
    postId?: string;
}

// Define interface for Facebook API data
interface FacebookPost {
    id: string;
    message?: string;
    created_time: string;
    full_picture?: string;
}

interface FacebookComment {
    id: string;
    message: string;
    from: { name: string };
    created_time: string;
    parent?: { id: string };
}

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string };
}
const router = express.Router();

// Delay function to avoid API rate limiting
async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Get posts for a page
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
            { params: { access_token: page.access_token, fields: "id,message,created_time,full_picture" } }
        );

        for (const post of data.data) {
            await Post.updateOne(
                { postId: post.id },
                {
                    pageId,
                    postId: post.id,
                    message: post.message,
                    created_time: post.created_time,
                    picture: post.full_picture || null
                },
                { upsert: true }
            );
        }

        res.json(data.data);
    } catch (error) {
        console.error("❌ Lỗi khi lấy bài đăng từ Facebook:", error);
        res.status(500).json({ error: "Không thể lấy bài đăng từ Facebook" });
    }
});

// Get comments for a post
router.get("/:pageId/:postId/comments", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { pageId, postId } = req.params;
    const { limit = 100, skip = 0 } = req.query;
    try {
        const user = await User.findById(req.user?.id);
        if (!user || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
            return;
        }
        if (!pageId || !postId || postId === "undefined" || !/^[0-9_]+$/.test(postId)) {
            res.status(400).json({ error: "pageId hoặc postId không hợp lệ" });
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

        const post = await Post.findOne({ postId });
        if (!post) {
            res.status(404).json({ error: "Không tìm thấy bài đăng" });
            return;
        }

        // Fetch all comments
        const comments = await fetchAllComments(postId, page.access_token);
        const bulkOps = comments.map(cmt => ({
            updateOne: {
                filter: { commentId: cmt.id },
                update: {
                    postId,
                    commentId: cmt.id,
                    message: cmt.message,
                    from: cmt.from?.name || "Fanpage",
                    created_time: cmt.created_time,
                    parent_id: cmt.parent?.id || null
                },
                upsert: true
            }
        }));

        if (bulkOps.length > 0) {
            await Comment.bulkWrite(bulkOps);
        }

        // Return comments from database
        const savedComments = await Comment.find({ postId })
            .sort({ created_time: 1 })
            .limit(Number(limit))
            .skip(Number(skip))
            .lean();
        res.json(savedComments);
    } catch (error: any) {
        console.error("❌ Lỗi khi lấy bình luận từ Facebook:", error.response?.data?.error || error.message);
        const errorCode = error.response?.data?.error?.code;
        if (errorCode === 190) {
            await Page.updateOne({ pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau." });
        } else {
            res.status(500).json({ error: "Không thể lấy bình luận từ Facebook", detail: error.message });
        }
    }
});

async function fetchNestedComments(commentId: string, access_token: string): Promise<FacebookComment[]> {
    let allComments: FacebookComment[] = [];
    let url = `https://graph.facebook.com/v18.0/${commentId}/comments?access_token=${access_token}&fields=id,message,from,created_time,parent&limit=100`;

    while (url) {
        try {
            const { data } = await axios.get(url);
            if (!data.data) {
                console.warn(`Không có dữ liệu bình luận cho comment ${commentId}`);
                break;
            }
            allComments = [...allComments, ...data.data];
            url = data.paging?.next || '';
            if (url) await delay(500);
        } catch (error: any) {
            console.error(`Lỗi khi lấy phản hồi lồng nhau cho comment ${commentId}:`, error.response?.data?.error || error.message);
            break;
        }
    }

    return allComments;
}

// posts.ts
async function fetchAllComments(postId: string, access_token: string): Promise<FacebookComment[]> {
    let allComments: FacebookComment[] = [];
    let url = `https://graph.facebook.com/v18.0/${postId}/comments?access_token=${access_token}&fields=id,message,from.name,from.picture,created_time,parent&limit=100`;
    while (url) {
        const { data } = await axios.get(url);
        if (!data.data) break;
        allComments = [...allComments, ...data.data];
        for (const comment of data.data) {
            if (!comment.parent) {
                const nestedComments = await fetchNestedComments(comment.id, access_token);
                allComments = [...allComments, ...nestedComments];
            }
        }
        url = data.paging?.next || '';
        if (url) await delay(500);
    }
    return allComments;
}

export default router;