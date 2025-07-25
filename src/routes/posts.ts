import express, { Request, Response } from "express";
import axios from "axios";
import Redis from "ioredis";
import Page from "../models/Page";
import Post from "../models/Post";
import User from "../models/User";
import { authMiddleware } from "../middleware/auth";
import winston from "winston";
import { batchRequest } from "../services/facebook";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string; role: string };
}

interface CreatePostRequestBody {
    message: string;
    pictureUrl?: string;
    scheduledTime?: string;
}

interface PostQuery {
    limit?: string;
    skip?: string;
    search?: string;
    status?: string;
}

const router = express.Router();

/**
 * Delay function to prevent API rate limiting
 * @param ms - Milliseconds to delay
 */
async function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get posts with search and filter
 * @route GET /posts/:pageId
 * @query {limit, skip, search, status}
 */
router.get("/:pageId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { pageId } = req.params;
    const { limit = "10", skip = "0", search, status } = req.query as PostQuery;

    try {
        if (!pageId || !/^[0-9_]+$/.test(pageId)) {
            res.status(400).json({ error: "pageId không hợp lệ" });
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

        const cacheKey = `posts:${pageId}:${limit}:${skip}:${JSON.stringify({ search, status })}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.json(JSON.parse(cached));
            return;
        }

        let allPosts: any[] = [];
        let url = `https://graph.facebook.com/v23.0/${pageId}/posts?access_token=${page.access_token}&fields=id,message,created_time,full_picture,permalink_url,likes.summary(true),shares,reactions.summary(true)&limit=50`;
        let pageCount = 0;
        const maxPages = 5;

        while (url && pageCount < maxPages) {
            const batchRequests = [{ method: "GET", relative_url: url.split("https://graph.facebook.com/v23.0/")[1] }];
            const batchResponse = await batchRequest(batchRequests, page.access_token);
            const data = JSON.parse(batchResponse[0].body);
            if (!Array.isArray(data.data)) {
                throw new Error("Dữ liệu bài đăng không hợp lệ từ Facebook");
            }
            allPosts = [...allPosts, ...data.data];
            url = data.paging?.next || "";
            pageCount++;
            if (url) await delay(500);
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
                    permalink_url: post.permalink_url || null,
                    likes: post.likes?.summary?.total_count || 0,
                    shares: post.shares?.count || 0,
                    reactions: {
                        like: post.reactions?.summary?.like || 0,
                        love: post.reactions?.summary?.love || 0,
                        haha: post.reactions?.summary?.haha || 0,
                        wow: post.reactions?.summary?.wow || 0,
                        sad: post.reactions?.summary?.sad || 0,
                        angry: post.reactions?.summary?.angry || 0
                    },
                    status: "published"
                },
                upsert: true
            }
        }));

        if (bulkOps.length > 0) {
            await Post.bulkWrite(bulkOps);
            logger.info("Posts synced to database", { pageId, count: bulkOps.length });
        }

        const query: any = { pageId, facebookId: user.facebookId };
        if (search) {
            query.message = { $regex: search, $options: "i" };
        }
        if (status) {
            query.status = status;
        }

        const posts = await Post.find(query)
            .sort({ created_time: -1 })
            .limit(Number(limit))
            .skip(Number(skip))
            .lean();

        await redis.setex(cacheKey, 300, JSON.stringify(posts)); // Cache for 5 minutes
        logger.info("Posts fetched", { pageId, userId: req.user?.id, count: posts.length });
        res.json(posts);
    } catch (error: any) {
        logger.error("Error fetching posts", { error: error.message, userId: req.user?.id });
        const errorCode = error.response?.data?.error?.code;
        if (errorCode === 190) {
            await Page.updateOne({ pageId }, { connected: false });
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

/**
 * Create new post
 * @route POST /posts/:pageId
 * @body {message, pictureUrl, scheduledTime}
 */
router.post("/:pageId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const { pageId } = req.params;
    const { message, pictureUrl, scheduledTime } = req.body as CreatePostRequestBody;

    try {
        if (!pageId || !/^[0-9_]+$/.test(pageId) || !message) {
            res.status(400).json({ error: "Thiếu pageId hoặc message" });
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

        const payload: any = { message };
        if (pictureUrl) payload.link = pictureUrl;
        if (scheduledTime) {
            payload.scheduled_publish_time = Math.floor(new Date(scheduledTime).getTime() / 1000);
            payload.published = false;
        }

        const { data } = await axios.post(`https://graph.facebook.com/v23.0/${pageId}/feed`, payload, {
            params: { access_token: page.access_token }
        });

        const post = new Post({
            facebookId: user.facebookId,
            pageId,
            postId: data.id,
            message,
            created_time: scheduledTime ? new Date(scheduledTime) : new Date(),
            picture: pictureUrl || null,
            status: scheduledTime ? "scheduled" : "published"
        });
        await post.save();

        logger.info("Post created", { postId: data.id, pageId, userId: req.user?.id });
        res.json(post);
    } catch (error: any) {
        logger.error("Error creating post", { error: error.message, userId: req.user?.id });
        const errorCode = error.response?.data?.error?.code;
        if (errorCode === 190) {
            await Page.updateOne({ pageId }, { connected: false });
            res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau." });
        } else if (errorCode === 100) {
            res.status(400).json({ error: "Tham số không hợp lệ trong yêu cầu Facebook" });
        } else if (errorCode === 200) {
            res.status(403).json({ error: "Quyền truy cập không đủ hoặc token không hợp lệ" });
        } else {
            res.status(500).json({ error: "Không thể tạo bài đăng", detail: error.message });
        }
    }
});

export default router;