import express, { Request, Response } from "express";
import axios from "axios";
import Redis from "ioredis";
import Comment from "../models/Comment";
import Post from "../models/Post";
import Page from "../models/Page";
import User from "../models/User";
import { authMiddleware } from "../middleware/auth";
import winston from "winston";
import { batchRequest } from "../services/facebook";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string; role: string };
}

interface FacebookComment {
    id: string;
    message: string;
    from: { id: string; name: string; picture?: { data: { url: string } } };
    created_time: string;
    parent?: { id: string };
    reactions?: { summary: { like: number; love: number; haha: number; wow: number; sad: number; angry: number } };
}

interface CommentQuery {
    limit?: string;
    skip?: string;
    search?: string;
    status?: string;
    hidden?: string;
}

const router = express.Router();
const phoneRegex = /(0|\+84)(\d{9,10})\b/;

/**
 * Delay function to prevent API rate limiting
 * @param ms - Milliseconds to delay
 */
async function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch nested comments with rate limiting
 * @param commentId - Parent comment ID
 * @param accessToken - Page access token
 * @param redis - Redis client
 * @returns Array of nested comments
 */
async function fetchNestedComments(commentId: string, accessToken: string, redis: Redis): Promise<FacebookComment[]> {
    const cacheKey = `nested_comments:${commentId}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    let allComments: FacebookComment[] = [];
    let url = `https://graph.facebook.com/v23.0/${commentId}/comments?access_token=${accessToken}&fields=id,message,from.id,from.name,from.picture.data.url,created_time,parent,reactions.summary(true)&limit=100`;
    let pageCount = 0;
    const maxPages = 3;

    while (url && pageCount < maxPages) {
        try {
            const { data } = await axios.get(url);
            if (!Array.isArray(data.data)) break;
            allComments = [...allComments, ...data.data];
            url = data.paging?.next || "";
            pageCount++;
            if (url) await delay(500);
        } catch (error: any) {
            throw new Error(`Không thể lấy bình luận lồng nhau: ${error.message}`);
        }
    }

    await redis.setex(cacheKey, 300, JSON.stringify(allComments)); // Cache for 5 minutes
    return allComments;
}

/**
 * Fetch all comments using batch requests
 * @param postId - Post ID
 * @param accessToken - Page access token
 * @param redis - Redis client
 * @returns Array of comments
 */
async function fetchAllComments(postId: string, accessToken: string, redis: Redis): Promise<FacebookComment[]> {
    const cacheKey = `comments:${postId}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    let allComments: FacebookComment[] = [];
    let url = `https://graph.facebook.com/v23.0/${postId}/comments?access_token=${accessToken}&fields=id,message,from.id,from.name,from.picture.data.url,created_time,parent,reactions.summary(true)&limit=100`;
    let pageCount = 0;
    const maxPages = 5;

    // Prepare batch requests
    const batchRequests = [{ method: "GET", relative_url: url.split("https://graph.facebook.com/v23.0/")[1] }];
    while (url && pageCount < maxPages) {
        const batchResponse = await batchRequest(batchRequests, accessToken);
        const data = JSON.parse(batchResponse[0].body);
        if (!Array.isArray(data.data)) {
            throw new Error("Dữ liệu bình luận không hợp lệ từ Facebook");
        }
        allComments = [...allComments, ...data.data];

        // Fetch nested comments for non-parent comments
        const nestedPromises = data.data
            .filter((comment: FacebookComment) => !comment.parent)
            .map((comment: FacebookComment) => fetchNestedComments(comment.id, accessToken, redis));
        const nestedComments = (await Promise.all(nestedPromises)).flat();
        allComments = [...allComments, ...nestedComments];

        url = data.paging?.next || "";
        if (url) {
            batchRequests[0].relative_url = url.split("https://graph.facebook.com/v23.0/")[1];
            pageCount++;
            await delay(500);
        }
    }

    await redis.setex(cacheKey, 300, JSON.stringify(allComments)); // Cache for 5 minutes
    return allComments;
}

/**
 * Get comments with search and filter
 * @route GET /comments/:postId
 * @query {limit, skip, search, status, hidden}
 */
router.get("/:postId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    try {
        const { postId } = req.params;
        const { limit = "10", skip = "0", search, status, hidden } = req.query as CommentQuery;

        if (!postId || !/^[0-9_]+$/.test(postId)) {
            res.status(400).json({ error: "postId không hợp lệ" });
            return;
        }

        const user = await User.findById(req.user?.id).lean();
        if (!user || !user.isActive || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
            return;
        }

        const post = await Post.findOne({ postId }).lean();
        if (!post) {
            res.status(404).json({ error: "Không tìm thấy bài đăng" });
            return;
        }

        const page = await Page.findOne({ pageId: post.pageId, facebookId: user.facebookId }).lean();
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền" });
            return;
        }

        if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
            await Page.updateOne({ pageId: post.pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
            return;
        }

        const redis = req.app.get("redis") as Redis;
        const comments = await fetchAllComments(postId, page.access_token, redis);

        const bulkOps = comments.map((cmt: FacebookComment) => ({
            updateOne: {
                filter: { commentId: cmt.id },
                update: {
                    postId,
                    commentId: cmt.id,
                    message: cmt.message,
                    from: cmt.from?.name || "Unknown",
                    picture: cmt.from?.picture?.data?.url || null,
                    created_time: new Date(cmt.created_time),
                    parent_id: cmt.parent?.id || null,
                    facebookId: page.facebookId,
                    hidden: phoneRegex.test(cmt.message) ? true : false,
                    status: phoneRegex.test(cmt.message) ? "rejected" : "approved",
                    reactions: {
                        like: cmt.reactions?.summary?.like || 0,
                        love: cmt.reactions?.summary?.love || 0,
                        haha: cmt.reactions?.summary?.haha || 0,
                        wow: cmt.reactions?.summary?.wow || 0,
                        sad: cmt.reactions?.summary?.sad || 0,
                        angry: cmt.reactions?.summary?.angry || 0
                    }
                },
                upsert: true
            }
        }));

        if (bulkOps.length > 0) {
            await Comment.bulkWrite(bulkOps);
            logger.info("Comments synced to database", { postId, count: bulkOps.length });
        }

        const query: any = { postId, facebookId: user.facebookId };
        if (search) {
            query.message = { $regex: search, $options: "i" };
        }
        if (status) {
            query.status = status;
        }
        if (hidden !== undefined) {
            query.hidden = hidden === "true";
        }

        const cacheKey = `db_comments:${postId}:${limit}:${skip}:${JSON.stringify({ search, status, hidden })}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        const savedComments = await Comment.find(query)
            .sort({ created_time: -1 })
            .limit(Number(limit))
            .skip(Number(skip))
            .lean();

        await redis.setex(cacheKey, 300, JSON.stringify(savedComments)); // Cache for 5 minutes
        logger.info("Comments fetched", { postId, userId: req.user?.id, count: savedComments.length });
        res.json(savedComments);
    } catch (error: any) {
        logger.error("Error fetching comments", { error: error.message, userId: req.user?.id });
        const errorCode = error.response?.data?.error?.code;
        if (errorCode === 190) {
            await Page.updateOne({ pageId: (await Post.findOne({ postId: req.params.postId }))?.pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau." });
        } else if (errorCode === 100) {
            res.status(400).json({ error: "Tham số không hợp lệ trong yêu cầu Facebook" });
        } else if (errorCode === 200) {
            res.status(403).json({ error: "Quyền truy cập không đủ hoặc token không hợp lệ." });
        } else {
            res.status(500).json({ error: "Không thể lấy bình luận từ Facebook", detail: error.message });
        }
    }
});

/**
 * Create new comment
 * @route POST /comments/:postId
 * @body {message, parentId, status}
 */
router.post("/:postId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    try {
        const { postId } = req.params;
        const { message, parentId, status = "pending" } = req.body;

        if (!postId || !/^[0-9_]+$/.test(postId) || !message) {
            res.status(400).json({ error: "Thiếu postId hoặc message" });
            return;
        }

        if (status && !["pending", "approved", "rejected"].includes(status)) {
            res.status(400).json({ error: "Trạng thái không hợp lệ" });
            return;
        }

        const user = await User.findById(req.user?.id).lean();
        if (!user || !user.isActive || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
            return;
        }

        const post = await Post.findOne({ postId }).lean();
        if (!post) {
            res.status(404).json({ error: "Không tìm thấy bài đăng" });
            return;
        }

        const page = await Page.findOne({ pageId: post.pageId, facebookId: user.facebookId }).lean();
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền" });
            return;
        }

        if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
            await Page.updateOne({ pageId: post.pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
            return;
        }

        let fbRes;
        if (!parentId) {
            fbRes = await axios.post(`https://graph.facebook.com/v23.0/${postId}/comments`, { message }, {
                params: { access_token: page.access_token }
            });
        } else {
            fbRes = await axios.post(`https://graph.facebook.com/v23.0/${parentId}/comments`, { message }, {
                params: { access_token: page.access_token }
            });
        }

        const fbCommentId = fbRes.data.id;
        const hidden = phoneRegex.test(message) || status !== "approved";

        const comment = new Comment({
            postId,
            commentId: fbCommentId,
            message,
            from: page.name || "Fanpage",
            picture: page.picture || null,
            created_time: new Date(),
            parent_id: parentId || null,
            facebookId: page.facebookId,
            hidden,
            status
        });
        await comment.save();

        if (hidden) {
            await axios.post(`https://graph.facebook.com/v23.0/${fbCommentId}?is_hidden=true`, {}, {
                params: { access_token: page.access_token }
            });
        }

        const io = req.app.get("io");
        io.to(post.pageId).emit("fb_comment", {
            postId,
            commentId: fbCommentId,
            message,
            from: page.name || "Fanpage",
            created_time: comment.created_time,
            parent_id: parentId || null,
            picture: page.picture || null,
            hidden,
            status
        });

        logger.info("Comment created", { commentId: fbCommentId, postId, userId: req.user?.id });
        res.json(comment);
    } catch (error: any) {
        logger.error("Error creating comment", { error: error.message, userId: req.user?.id });
        const errorCode = error.response?.data?.error?.code;
        if (errorCode === 190) {
            await Page.updateOne({ pageId: (await Post.findOne({ postId: req.params.postId }))?.pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau." });
        } else if (errorCode === 100) {
            res.status(400).json({ error: "Tham số không hợp lệ trong yêu cầu Facebook" });
        } else if (errorCode === 200) {
            res.status(403).json({ error: "Quyền truy cập không đủ hoặc token không hợp lệ." });
        } else {
            res.status(500).json({ error: "Không thể tạo bình luận trên Facebook", detail: error.message });
        }
    }
});

/**
 * Update comment status (pending, approved, rejected)
 * @route POST /comments/update-status/:commentId
 * @body {pageId, status}
 */
router.post("/update-status/:commentId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    try {
        const { commentId } = req.params;
        const { pageId, status } = req.body;

        if (!commentId || !/^[0-9_]+$/.test(commentId) || !pageId || !status) {
            res.status(400).json({ error: "Thiếu commentId, pageId hoặc status" });
            return;
        }

        if (!["pending", "approved", "rejected"].includes(status)) {
            res.status(400).json({ error: "Trạng thái không hợp lệ" });
            return;
        }

        const user = await User.findById(req.user?.id).lean();
        if (!user || !user.isActive || !user.facebookId) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
            return;
        }

        const page = await Page.findOne({ pageId, facebookId: user.facebookId }).lean();
        if (!page) {
            res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền" });
            return;
        }

        if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
            await Page.updateOne({ pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
            return;
        }

        const comment = await Comment.findOne({ commentId, facebookId: page.facebookId });
        if (!comment) {
            res.status(404).json({ error: "Không tìm thấy bình luận" });
            return;
        }

        comment.status = status;
        comment.hidden = status !== "approved";
        await comment.save();

        await axios.post(`https://graph.facebook.com/v23.0/${commentId}?is_hidden=${comment.hidden}`, {}, {
            params: { access_token: page.access_token }
        });

        const io = req.app.get("io");
        io.to(pageId).emit("fb_comment_status", { commentId, status, hidden: comment.hidden });

        logger.info("Comment status updated", { commentId, status, pageId, userId: req.user?.id });
        res.json({ success: true, comment });
    } catch (error: any) {
        logger.error("Error updating comment status", { error: error.message, userId: req.user?.id });
        const errorCode = error.response?.data?.error?.code;
        if (errorCode === 190) {
            await Page.updateOne({ pageId: req.body.pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau." });
        } else if (errorCode === 100) {
            res.status(400).json({ error: "Tham số không hợp lệ trong yêu cầu Facebook" });
        } else if (errorCode === 200) {
            res.status(403).json({ error: "Quyền truy cập không đủ hoặc token không hợp lệ." });
        } else {
            res.status(500).json({ error: "Không thể cập nhật trạng thái bình luận", detail: error.message });
        }
    }
});

export default router;