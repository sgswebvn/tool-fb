import express, { Request, Response } from "express";
import crypto from "crypto";
import Redis from "ioredis";
import Page from "../models/Page";
import Comment from "../models/Comment";
import Message from "../models/Message";
import winston from "winston";

const router = express.Router();
const phoneRegex = /(0|\+84)(\d{9,10})\b/;

interface WebhookEntry {
    id: string;
    changes?: { field: string; value: any }[];
    messaging?: { sender: { id: string }; recipient: { id: string }; timestamp: number; message: { mid: string; text: string } }[];
}

/**
 * Verify webhook subscription
 * @route GET /webhook
 */
router.get("/", (req: Request, res: Response) => {
    const logger = req.app.get("logger") as winston.Logger;
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.FB_WEBHOOK_TOKEN) {
        logger.info("Webhook verified");
        res.status(200).send(challenge);
    } else {
        logger.warn("Webhook verification failed");
        res.status(403).json({ error: "Xác minh webhook thất bại" });
    }
});

/**
 * Handle webhook events
 * @route POST /webhook
 */
router.post("/", async (req: Request, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const signature = req.headers["x-hub-signature"] as string;
    const body = req.body;

    try {
        // Verify signature
        if (!signature) {
            res.status(400).json({ error: "Thiếu chữ ký X-Hub-Signature" });
            return;
        }

        const computedSignature = crypto
            .createHmac("sha1", process.env.FB_APP_SECRET || "")
            .update(JSON.stringify(body))
            .digest("hex");
        if (`sha1=${computedSignature}` !== signature) {
            res.status(400).json({ error: "Chữ ký không hợp lệ" });
            return;
        }

        if (body.object !== "page" || !Array.isArray(body.entry)) {
            res.status(400).json({ error: "Dữ liệu webhook không hợp lệ" });
            return;
        }

        for (const entry of body.entry as WebhookEntry[]) {
            const page = await Page.findOne({ facebookId: entry.id }).lean();
            if (!page) {
                logger.warn("Page not found for webhook", { facebookId: entry.id });
                continue;
            }

            // Handle comment events
            if (entry.changes) {
                for (const change of entry.changes) {
                    if (change.field === "comments" && change.value?.verb === "add") {
                        const commentData = change.value;
                        const commentId = commentData.comment_id || commentData.id;
                        const cacheKey = `webhook_comment:${commentId}`;
                        if (await redis.get(cacheKey)) continue; // Skip duplicates

                        const hidden = phoneRegex.test(commentData.message);
                        const comment = new Comment({
                            facebookId: page.facebookId,
                            postId: commentData.post_id,
                            commentId,
                            message: commentData.message,
                            from: commentData.from?.name || "Unknown",
                            picture: commentData.from?.picture?.data?.url || null,
                            created_time: new Date(commentData.created_time * 1000),
                            parent_id: commentData.parent_id || null,
                            hidden,
                            status: hidden ? "rejected" : "approved"
                        });
                        await comment.save();

                        await redis.setex(cacheKey, 3600, "1"); // Cache for 1 hour

                        const io = req.app.get("io");
                        io.to(page.pageId).emit("fb_comment", {
                            postId: commentData.post_id,
                            commentId,
                            message: commentData.message,
                            from: commentData.from?.name || "Unknown",
                            created_time: comment.created_time,
                            parent_id: commentData.parent_id || null,
                            picture: commentData.from?.picture?.data?.url || null,
                            hidden,
                            status: comment.status
                        });

                        logger.info("Webhook comment processed", { commentId, pageId: page.pageId });
                    }
                }
            }

            // Handle message events
            if (entry.messaging) {
                for (const msg of entry.messaging) {
                    const messageId = msg.message.mid;
                    const cacheKey = `webhook_message:${messageId}`;
                    if (await redis.get(cacheKey)) continue; // Skip duplicates

                    const isFromPage = msg.sender.id === page.facebookId;
                    const message = new Message({
                        id: messageId,
                        facebookId: page.facebookId,
                        pageId: page.pageId,
                        senderId: msg.sender.id,
                        senderName: isFromPage ? page.name : "User",
                        recipientId: msg.recipient.id,
                        message: msg.message.text,
                        direction: isFromPage ? "out" : "in",
                        timestamp: new Date(msg.timestamp),
                        conversationId: msg.recipient.id,
                        status: "delivered"
                    });
                    await message.save();

                    await redis.setex(cacheKey, 3600, "1"); // Cache for 1 hour

                    const io = req.app.get("io");
                    io.to(page.pageId).emit("fb_message", {
                        id: messageId,
                        pageId: page.pageId,
                        conversationId: msg.recipient.id,
                        senderId: msg.sender.id,
                        senderName: isFromPage ? page.name : "User",
                        recipientId: msg.recipient.id,
                        message: msg.message.text,
                        direction: isFromPage ? "out" : "in",
                        timestamp: message.timestamp,
                        status: "delivered"
                    });

                    logger.info("Webhook message processed", { messageId, pageId: page.pageId });
                }
            }
        }

        res.status(200).json({ success: true });
    } catch (error: any) {
        logger.error("Error processing webhook", { error: error.message });
        res.status(500).json({ error: "Lỗi xử lý webhook", detail: error.message });
    }
});

export default router;