import express, { Request, Response } from "express";
import Message from "../models/Message";
import Page from "../models/Page";
import User from "../models/User";
import Comment from "../models/Comment";
import Post from "../models/Post";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

const phoneRegex = /(0|\+84)(\d{9,10})\b/;

// Cache thông tin người dùng từ Facebook
const userInfoCache: { [key: string]: any } = {};

async function getFacebookUserInfo(senderId: string, accessToken: string) {
    if (userInfoCache[senderId]) {
        return userInfoCache[senderId];
    }
    try {
        const { data } = await axios.get(`https://graph.facebook.com/${senderId}?fields=name,picture&access_token=${accessToken}`);
        userInfoCache[senderId] = data;
        setTimeout(() => delete userInfoCache[senderId], 3600 * 1000); // Xóa cache sau 1 giờ
        return data;
    } catch (error: any) {
        console.error(`Lỗi khi lấy thông tin người dùng ${senderId}:`, error?.response?.data?.error || error.message);
        return null;
    }
}

router.post("/", async (req: Request, res: Response) => {
    try {
        const body = req.body;
        if (body.object !== "page" || !body.entry || !Array.isArray(body.entry)) {
            console.warn("Webhook payload không hợp lệ:", body);
            res.sendStatus(404);
            return;
        }

        for (const entry of body.entry) {
            const pageId = entry.id;
            const page = await Page.findOne({ pageId, connected: true });
            if (!page) {
                console.warn(`Không tìm thấy page ${pageId} hoặc page chưa kết nối`);
                continue;
            }

            const user = await User.findOne({ facebookId: page.facebookId }).lean();
            if (!user || !user.isActive) {
                console.warn(`Người dùng với facebookId ${page.facebookId} không tồn tại hoặc bị khóa`);
                continue;
            }

            // Xử lý tin nhắn
            for (const event of entry.messaging || []) {
                if (event.message && event.sender && event.recipient) {
                    const senderId = event.sender.id;
                    const recipientId = event.recipient.id;
                    const message = event.message.text || "";
                    const userInfo = await getFacebookUserInfo(senderId, page.access_token);
                    const messageId = event.message.mid || uuidv4();

                    const newMsg = await Message.create({
                        id: messageId,
                        facebookId: page.facebookId,
                        pageId,
                        senderId,
                        senderName: userInfo?.name || "Unknown",
                        recipientId,
                        message,
                        direction: senderId === pageId ? "out" : "in",
                        timestamp: new Date(),
                        avatar: userInfo?.picture?.data?.url || null,
                    });

                    const io = req.app.get("io");
                    if (io) {
                        io.to(pageId).emit("fb_message", {
                            id: messageId,
                            pageId,
                            senderId,
                            senderName: userInfo?.name || "Unknown",
                            recipientId,
                            message,
                            direction: senderId === pageId ? "out" : "in",
                            timestamp: newMsg.timestamp,
                            avatar: userInfo?.picture?.data?.url || null,
                        });
                    }
                }
            }

            // Xử lý bình luận
            for (const event of entry.changes || []) {
                if (event.field === "feed" && event.value.item === "comment") {
                    const comment = event.value;
                    const userInfo = await getFacebookUserInfo(comment.from.id, page.access_token);
                    const hidden = phoneRegex.test(comment.message);

                    if (hidden) {
                        try {
                            await axios.post(`https://graph.facebook.com/v18.0/${comment.comment_id}?hide=true`, {}, {
                                params: { access_token: page.access_token },
                            });
                        } catch (error: any) {
                            console.error(`Lỗi khi ẩn bình luận ${comment.comment_id}:`, error?.response?.data?.error || error.message);
                        }
                    }

                    const newComment = await Comment.create({
                        postId: comment.post_id,
                        commentId: comment.comment_id,
                        message: comment.message,
                        from: userInfo?.name || "Unknown",
                        created_time: new Date(comment.created_time),
                        parent_id: comment.parent_id || null,
                        picture: userInfo?.picture?.data?.url || null,
                        facebookId: page.facebookId,
                        hidden,
                    });

                    const io = req.app.get("io");
                    if (io) {
                        io.to(pageId).emit("fb_comment", {
                            postId: comment.post_id,
                            commentId: comment.comment_id,
                            message: comment.message,
                            from: userInfo?.name || "Unknown",
                            created_time: comment.created_time,
                            parent_id: comment.parent_id || null,
                            picture: userInfo?.picture?.data?.url || null,
                            hidden,
                        });
                        if (hidden) {
                            io.to(pageId).emit("fb_comment_hidden", { commentId: comment.comment_id, hidden: true });
                        }
                    }
                }

                // Xử lý bài viết mới
                if (event.field === "feed" && event.value.item === "post") {
                    const post = event.value;
                    const postId = post.post_id;
                    const message = post.message || "";
                    const createdTime = post.created_time;

                    const bulkOps = [{
                        updateOne: {
                            filter: { postId },
                            update: {
                                pageId,
                                postId,
                                message,
                                created_time: new Date(createdTime),
                                picture: post.photo_id ? `https://graph.facebook.com/${post.photo_id}/picture?access_token=${page.access_token}` : null,
                                likes: 0,
                                shares: 0,
                            },
                            upsert: true,
                        },
                    }];

                    await Post.bulkWrite(bulkOps);

                    const io = req.app.get("io");
                    if (io) {
                        io.to(pageId).emit("fb_post", {
                            postId,
                            pageId,
                            message,
                            created_time: createdTime,
                            picture: post.photo_id ? `https://graph.facebook.com/${post.photo_id}/picture?access_token=${page.access_token}` : null,
                        });
                    }
                }
            }
        }

        res.sendStatus(200);
    } catch (error: any) {
        console.error("❌ Lỗi webhook:", error?.response?.data?.error || error.message);
        const errorCode = error?.response?.data?.error?.code;
        if (errorCode === 190) {
            res.status(400).json({ error: "Token không hợp lệ" });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API" });
        } else if (errorCode === 100) {
            res.status(400).json({ error: "Tham số không hợp lệ trong yêu cầu Facebook" });
        } else if (errorCode === 200) {
            res.status(403).json({ error: "Quyền truy cập không đủ hoặc token không hợp lệ" });
        } else {
            res.status(500).json({ error: "Lỗi xử lý webhook", detail: error.message });
        }
    }
});

router.get("/", async (req: Request, res: Response): Promise<void> => {
    try {
        const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || "verify";
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];
        if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } catch (error: any) {
        console.error("❌ Lỗi xác thực webhook:", error.message);
        res.sendStatus(500);
    }
});

export default router;