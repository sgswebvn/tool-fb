import express, { Request, Response } from "express";
import axios from "axios";
import Comment from "../models/Comment";
import Post from "../models/Post";
import Page from "../models/Page";
import User from "../models/User";
import { authMiddleware } from "../middleware/auth";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string; role: string };
}

interface FacebookComment {
    id: string;
    message: string;
    from: { name: string; picture?: { data: { url: string } } };
    created_time: string;
    parent?: { id: string };
}

const router = express.Router();

const phoneRegex = /(0|\+84)(\d{9,10})\b/;

// Delay function to avoid API rate limiting
async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch nested comments for a specific comment
async function fetchNestedComments(commentId: string, access_token: string): Promise<FacebookComment[]> {
    let allComments: FacebookComment[] = [];
    let url = `https://graph.facebook.com/v18.0/${commentId}/comments?access_token=${access_token}&fields=id,message,from.name,from.picture.data.url,created_time,parent&limit=100`;

    while (url) {
        try {
            const { data } = await axios.get(url);
            if (!data.data) {
                console.warn(`Không có dữ liệu bình luận cho comment ${commentId}`);
                break;
            }
            allComments = [...allComments, ...data.data];
            url = data.paging?.next || "";
            if (url) await delay(500);
        } catch (error: any) {
            console.error(`Lỗi khi lấy phản hồi lồng nhau cho comment ${commentId}:`, error?.response?.data?.error || error.message);
            break;
        }
    }
    return allComments;
}

// Fetch all comments for a post
async function fetchAllComments(postId: string, access_token: string): Promise<FacebookComment[]> {
    let allComments: FacebookComment[] = [];
    let url = `https://graph.facebook.com/v18.0/${postId}/comments?access_token=${access_token}&fields=id,message,from.name,from.picture.data.url,created_time,parent&limit=100`;

    while (url) {
        try {
            const { data } = await axios.get(url);
            if (!data.data) break;
            allComments = [...allComments, ...data.data];
            for (const comment of data.data) {
                if (!comment.parent) {
                    const nestedComments = await fetchNestedComments(comment.id, access_token);
                    allComments = [...allComments, ...nestedComments];
                }
            }
            url = data.paging?.next || "";
            if (url) await delay(500);
        } catch (error: any) {
            console.error(`Lỗi khi lấy bình luận cho post ${postId}:`, error?.response?.data?.error || error.message);
            throw error;
        }
    }
    return allComments;
}

// Get comments for a post
router.get("/:postId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { postId } = req.params;
        const { limit = 10, skip = 0 } = req.query;

        if (!postId || postId === "undefined" || !/^[0-9_]+$/.test(postId)) {
            res.status(400).json({ error: "postId không hợp lệ" });
            return;
        }

        const user = await User.findById(req.user?.id);
        if (!user || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
            return;
        }

        const post = await Post.findOne({ postId });
        if (!post) {
            res.status(404).json({ error: "Không tìm thấy bài đăng" });
            return;
        }

        const page = await Page.findOne({ pageId: post.pageId, facebookId: user.facebookId });
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền" });
            return;
        }

        // Check if token is expired
        if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
            await Page.updateOne({ pageId: post.pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
            return;
        }

        // Fetch comments from Facebook
        const comments = await fetchAllComments(postId, page.access_token);

        // Save or update comments in database
        const bulkOps = comments.map(cmt => ({
            updateOne: {
                filter: { commentId: cmt.id },
                update: {
                    postId,
                    commentId: cmt.id,
                    message: cmt.message,
                    from: cmt.from?.name || "Fanpage",
                    picture: cmt.from?.picture?.data?.url || null,
                    created_time: new Date(cmt.created_time),
                    parent_id: cmt.parent?.id || null,
                    facebookId: page.facebookId,
                    hidden: phoneRegex.test(cmt.message) ? true : false,
                },
                upsert: true,
            },
        }));

        if (bulkOps.length > 0) {
            await Comment.bulkWrite(bulkOps);
        }

        // Retrieve comments from database with pagination
        const savedComments = await Comment.find({ postId })
            .sort({ created_time: 1 })
            .limit(Number(limit))
            .skip(Number(skip))
            .lean();

        res.json(savedComments);
    } catch (error: any) {
        console.error("❌ Lỗi khi lấy bình luận:", error?.response?.data?.error || error.message);
        const errorCode = error?.response?.data?.error?.code;
        const post = await Post.findOne({ postId: req.params.postId });
        if (errorCode === 190 && post) {
            await Page.updateOne({ pageId: post.pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau." });
        } else {
            res.status(500).json({ error: "Không thể lấy bình luận từ Facebook", detail: error.message });
        }
    }
});

// Post a comment or reply to a comment
router.post("/:postId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { postId } = req.params;
        const { message, parentId } = req.body;

        if (!postId || !message) {
            res.status(400).json({ error: "Thiếu postId hoặc message" });
            return;
        }

        const user = await User.findById(req.user?.id);
        if (!user || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
            return;
        }

        const post = await Post.findOne({ postId });
        if (!post) {
            res.status(404).json({ error: "Không tìm thấy bài đăng" });
            return;
        }

        const page = await Page.findOne({ pageId: post.pageId, facebookId: user.facebookId });
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền" });
            return;
        }

        // Check if token is expired
        if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
            await Page.updateOne({ pageId: post.pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
            return;
        }

        // Post comment or reply to Facebook
        let fbRes;
        if (!parentId) {
            fbRes = await axios.post(`https://graph.facebook.com/v18.0/${postId}/comments`, { message }, {
                params: { access_token: page.access_token },
            });
        } else {
            fbRes = await axios.post(`https://graph.facebook.com/v18.0/${parentId}/comments`, { message }, {
                params: { access_token: page.access_token },
            });
        }

        const fbCommentId = fbRes.data.id;

        // Save comment to database
        const comment = new Comment({
            postId,
            commentId: fbCommentId,
            message,
            from: page.name || "Fanpage",
            picture: page.picture || null,
            created_time: new Date(),
            parent_id: parentId || null,
            facebookId: page.facebookId,
            hidden: phoneRegex.test(message) ? true : false,
        });
        await comment.save();

        // Hide comment on Facebook if it contains a phone number
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
    } catch (error: any) {
        console.error("❌ Lỗi khi tạo bình luận:", error?.response?.data?.error || error.message);
        const errorCode = error?.response?.data?.error?.code;
        const post = await Post.findOne({ postId: req.params.postId });
        if (errorCode === 190 && post) {
            await Page.updateOne({ pageId: post.pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau." });
        } else {
            res.status(500).json({ error: "Không thể tạo bình luận trên Facebook", detail: error.message });
        }
    }
});

// Hide or unhide a comment
router.post("/:commentId/hide", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { commentId } = req.params;
        const { pageId, hide } = req.body;

        if (!commentId || !pageId || hide === undefined) {
            res.status(400).json({ error: "Thiếu commentId, pageId hoặc hide" });
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

        const comment = await Comment.findOne({ commentId, facebookId: page.facebookId });
        if (!comment) {
            res.status(404).json({ error: "Không tìm thấy bình luận" });
            return;
        }

        // Check if token is expired
        if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
            await Page.updateOne({ pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
            return;
        }

        // Update comment visibility on Facebook
        await axios.post(`https://graph.facebook.com/v18.0/${commentId}?hide=${hide}`, {}, {
            params: { access_token: page.access_token },
        });

        // Update comment in database
        comment.hidden = hide;
        await comment.save();

        const io = req.app.get("io");
        if (io) {
            io.to(pageId).emit("fb_comment_hidden", { commentId, hidden: hide });
        }

        res.json({ success: true, hidden: hide });
    } catch (error: any) {
        console.error("❌ Lỗi khi ẩn/hiện bình luận:", error?.response?.data?.error || error.message);
        const errorCode = error?.response?.data?.error?.code;
        const { pageId } = req.body; // Use pageId from request body
        if (errorCode === 190 && pageId) {
            await Page.updateOne({ pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau." });
        } else {
            res.status(500).json({ error: "Không thể ẩn/hiện bình luận", detail: error.message });
        }
    }
});

export default router;