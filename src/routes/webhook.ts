import express, { Request, Response } from "express";
import Message from "../models/Message";
import Page from "../models/Page";
import User from "../models/User";
import Comment from "../models/Comment";
import axios from "axios";

const router = express.Router();

// Regex để phát hiện số điện thoại
const phoneRegex = /(0|\+84)(\d{9,10})\b/;

router.post("/", async (req: Request, res: Response) => {
    try {
        const body = req.body;
        if (body.object !== "page" || !body.entry || !Array.isArray(body.entry)) {
            res.sendStatus(404);
            return;
        }
        for (const entry of body.entry) {
            const pageId = entry.id;
            const page = await Page.findOne({ pageId, connected: true });
            if (!page) continue;
            const user = await User.findOne({ facebookId: page.facebookId });
            if (!user) continue;

            // Xử lý tin nhắn
            for (const event of entry.messaging || []) {
                if (event.message && event.sender && event.recipient) {
                    const senderId = event.sender.id;
                    const recipientId = event.recipient.id;
                    const message = event.message.text || "";
                    const { data: sender } = await axios.get(`https://graph.facebook.com/${senderId}?fields=name,picture&access_token=${page.access_token}`);
                    const newMsg = await Message.create({
                        facebookId: page.facebookId,
                        pageId,
                        senderId,
                        senderName: sender.name || "Unknown",
                        recipientId,
                        message,
                        direction: "in",
                        timestamp: new Date(),
                        avatar: sender.picture?.data?.url,
                    });
                    const io = req.app.get("io");
                    if (io) {
                        io.to(pageId).emit("fb_message", {
                            pageId,
                            senderId,
                            senderName: sender.name || "Unknown",
                            recipientId,
                            message,
                            direction: "in",
                            timestamp: newMsg.timestamp,
                            id: newMsg._id,
                            avatar: sender.picture?.data?.url,
                        });
                    }
                }
            }

            // Xử lý bình luận
            for (const event of entry.changes || []) {
                if (event.field === "feed" && event.value.item === "comment") {
                    const comment = event.value;
                    const { data: commenter } = await axios.get(`https://graph.facebook.com/${comment.from.id}?fields=name,picture&access_token=${page.access_token}`);
                    const hidden = phoneRegex.test(comment.message);
                    if (hidden) {
                        await axios.post(`https://graph.facebook.com/v18.0/${comment.comment_id}?hide=true`, {}, {
                            params: { access_token: page.access_token },
                        });
                    }
                    const newComment = await Comment.create({
                        postId: comment.post_id,
                        commentId: comment.comment_id,
                        message: comment.message,
                        from: commenter.name || "Unknown",
                        created_time: comment.created_time,
                        parent_id: comment.parent_id || null,
                        picture: commenter.picture?.data?.url,
                        hidden,
                    });
                    const io = req.app.get("io");
                    if (io) {
                        io.to(pageId).emit("fb_comment", {
                            postId: comment.post_id,
                            commentId: comment.comment_id,
                            message: comment.message,
                            from: commenter.name || "Unknown",
                            created_time: comment.created_time,
                            parent_id: comment.parent_id || null,
                            picture: commenter.picture?.data?.url,
                            hidden,
                        });
                        if (hidden) {
                            io.to(pageId).emit("fb_comment_hidden", { commentId: comment.comment_id, hidden: true });
                        }
                    }
                }
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Lỗi webhook:", error);
        res.sendStatus(500);
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
    } catch (error) {
        res.sendStatus(500);
    }
});

export default router;