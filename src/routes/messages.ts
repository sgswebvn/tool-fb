import express, { Request, Response } from "express";
import axios from "axios";
import { Server, Socket } from "socket.io";
import Redis from "ioredis";
import Page from "../models/Page";
import Message from "../models/Message";
import User from "../models/User";
import { authMiddleware } from "../middleware/auth";
import jwt from "jsonwebtoken";
import logger from "../logger";
import { getFacebookUser, batchRequest } from "../services/facebook";
import winston from "winston";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string; role: string };
}


interface ReplyRequestBody {
    pageId: string;
    recipientId: string;
    message: string;
    conversationId?: string;
}

interface MessageQuery {
    limit?: string;
    skip?: string;
    search?: string;
    status?: string;
}

interface FacebookConversation {
    id: string;
}

interface FacebookMessage {
    id: string;
    message: string;
    from: { id: string; name: string };
    to: { data: [{ id: string }] };
    created_time: string;
    attachments?: { data: { type: string; url: string }[] };
}

interface JoinData {
    pageId: string;
}

const router = express.Router();

/**
 * Delay function to prevent API rate limiting
 * @param ms - Milliseconds to delay
 */
async function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export const setupSocketHandlers = (socket: Socket) => {
    socket.on("join", async (data: JoinData) => {
        try {
            const userId = socket.data.user?.id;
            if (!data?.pageId || !/^[0-9_]+$/.test(data.pageId)) {
                socket.emit("error", { error: "pageId không hợp lệ" });
                return;
            }

            const user = await User.findById(userId).lean();
            if (!user || !user.isActive || !user.facebookId) {
                socket.emit("error", { error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
                return;
            }

            const page = await Page.findOne({ pageId: data.pageId, facebookId: user.facebookId, connected: true }).lean();
            if (!page) {
                socket.emit("error", { error: "Không có quyền truy cập page hoặc page chưa kết nối" });
                return;
            }

            if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
                await Page.updateOne({ pageId: data.pageId }, { connected: false });
                socket.emit("error", { error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
                return;
            }

            socket.join(data.pageId);
            socket.emit("fb_page_joined", { pageId: data.pageId });
            logger.info("User joined page room", { pageId: data.pageId, userId });
        } catch (err: any) {
            logger.error("Error joining page room", { error: err.message, userId: socket.data.user?.id });
            socket.emit("error", { error: "Lỗi khi tham gia room", detail: err.message });
        }
    });
};
export default (io: Server) => {
    // Socket.IO authentication middleware
    io.use((socket: Socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error("Thiếu token xác thực"));
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "default-secret-key") as any;
            socket.data.user = decoded;
            next();
        } catch (err) {
            next(new Error("Token không hợp lệ"));
        }
    });

    // Handle socket connection
    io.on("connection", (socket: Socket) => {

        socket.on("join", async (data: JoinData) => {
            try {
                const userId = socket.data.user?.id;
                if (!data?.pageId || !/^[0-9_]+$/.test(data.pageId)) {
                    socket.emit("error", { error: "pageId không hợp lệ" });
                    return;
                }

                const user = await User.findById(userId).lean();
                if (!user || !user.isActive || !user.facebookId) {
                    socket.emit("error", { error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
                    return;
                }

                const page = await Page.findOne({ pageId: data.pageId, facebookId: user.facebookId, connected: true }).lean();
                if (!page) {
                    socket.emit("error", { error: "Không có quyền truy cập page hoặc page chưa kết nối" });
                    return;
                }

                if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
                    await Page.updateOne({ pageId: data.pageId }, { connected: false });
                    socket.emit("error", { error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
                    return;
                }

                socket.join(data.pageId);
                socket.emit("fb_page_joined", { pageId: data.pageId });
                logger.info("User joined page room", { pageId: data.pageId, userId });
            } catch (err: any) {
                logger.error("Error joining page room", { error: err.message, userId: socket.data.user?.id });
                socket.emit("error", { error: "Lỗi khi tham gia room", detail: err.message });
            }
        });
    });

    /**
     * Get messages with search and filter
     * @route GET /messages/fb/:pageId
     * @query {limit, skip, search, status}
     */
    router.get("/fb/:pageId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const logger = req.app.get("logger") as winston.Logger;
        const redis = req.app.get("redis") as Redis;
        const { pageId } = req.params;
        const { limit = "10", skip = "0", search, status } = req.query as MessageQuery;
        const userId = req.user?.id;

        try {
            if (!pageId || !/^[0-9_]+$/.test(pageId)) {
                res.status(400).json({ error: "pageId không hợp lệ" });
                return;
            }

            if (!userId) {
                res.status(401).json({ error: "Không tìm thấy thông tin người dùng" });
                return;
            }

            const user = await User.findById(userId).lean();
            if (!user || !user.isActive || !user.facebookId) {
                res.status(404).json({ error: "Người dùng chưa kết nối với Facebook hoặc tài khoản bị khóa" });
                return;
            }

            const page = await Page.findOne({ pageId, facebookId: user.facebookId, connected: true }).lean();
            if (!page) {
                res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền truy cập" });
                return;
            }

            if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
                await Page.updateOne({ pageId }, { connected: false });
                res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
                return;
            }

            const cacheKey = `messages:${pageId}:${limit}:${skip}:${JSON.stringify({ search, status })}`;
            const cached = await redis.get(cacheKey);
            if (cached) {
                res.json(JSON.parse(cached));
                return;
            }

            const conversationsUrl = `https://graph.facebook.com/v23.0/${pageId}/conversations?access_token=${page.access_token}&fields=id&limit=${limit}&offset=${skip}`;
            const { data: conversations } = await axios.get<{ data: FacebookConversation[] }>(conversationsUrl);

            if (!Array.isArray(conversations.data)) {
                res.status(500).json({ error: "Dữ liệu hội thoại không hợp lệ từ Facebook" });
                return;
            }

            const batchRequests = conversations.data.map((conv: FacebookConversation) => ({
                method: "GET",
                relative_url: `${conv.id}/messages?fields=id,message,from,to,created_time,attachments&limit=20`
            }));

            const batchResponses = await batchRequest(batchRequests, page.access_token);
            const messagesByConversation = await Promise.all(
                conversations.data.map(async (conv: FacebookConversation, index: number) => {
                    const messagesData = JSON.parse(batchResponses[index].body);
                    if (!Array.isArray(messagesData.data)) {
                        return { conversationId: conv.id, customerInfo: null, messages: [] };
                    }

                    const customerMsg = messagesData.data.find((msg: FacebookMessage) => msg.from.id !== pageId);
                    let customerInfo = null;
                    if (customerMsg) {
                        customerInfo = await getFacebookUser(customerMsg.from.id, page.access_token, redis);
                    }

                    const messageData = await Promise.all(
                        messagesData.data.map(async (msg: FacebookMessage) => {
                            if (!msg.message) return null;
                            const userInfo = await getFacebookUser(msg.from.id, page.access_token, redis);
                            const avatar = userInfo?.picture?.data?.url || undefined;
                            const messageId = msg.id || `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;

                            const existingMessage = await Message.findOne({ id: messageId, pageId }).lean();
                            if (!existingMessage) {
                                await Message.create({
                                    id: messageId,
                                    senderId: msg.from.id,
                                    senderName: msg.from.name,
                                    recipientId: msg.to.data[0].id,
                                    message: msg.message,
                                    timestamp: new Date(msg.created_time),
                                    direction: msg.from.id === pageId ? "out" : "in",
                                    facebookId: user.facebookId,
                                    pageId,
                                    avatar,
                                    conversationId: conv.id,
                                    attachments: msg.attachments?.data.map((att: any) => ({
                                        type: att.type,
                                        url: att.url
                                    })),
                                    status: "delivered"
                                });
                            }

                            return {
                                id: messageId,
                                senderId: msg.from.id,
                                senderName: msg.from.name,
                                recipientId: msg.to.data[0].id,
                                message: msg.message,
                                timestamp: msg.created_time,
                                direction: msg.from.id === pageId ? "out" : "in",
                                avatar,
                                attachments: msg.attachments?.data.map((att: any) => ({
                                    type: att.type,
                                    url: att.url
                                })),
                                followed: existingMessage?.followed || false,
                                status: existingMessage?.status || "delivered"
                            };
                        })
                    );

                    return {
                        conversationId: conv.id,
                        customerInfo: customerInfo ? {
                            id: customerInfo.id,
                            name: customerInfo.name,
                            picture: customerInfo.picture?.data?.url || undefined
                        } : null,
                        messages: messageData.filter((msg) => msg !== null).sort((a, b) =>
                            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
                        )
                    };
                })
            );

            const query: any = { pageId, facebookId: user.facebookId };
            if (search) {
                query.message = { $regex: search, $options: "i" };
            }
            if (status) {
                query.status = status;
            }

            const dbMessages = await Message.find(query)
                .sort({ timestamp: -1 })
                .limit(Number(limit))
                .skip(Number(skip))
                .lean();

            const response = { conversations: messagesByConversation, dbMessages };
            await redis.setex(cacheKey, 300, JSON.stringify(response)); // Cache for 5 minutes

            logger.info("Messages fetched", { pageId, userId, count: dbMessages.length });
            res.json(response);
        } catch (err: any) {
            logger.error("Error fetching messages", { error: err.message, userId });
            const errorCode = err.response?.data?.error?.code;
            if (errorCode === 190) {
                await Page.updateOne({ pageId }, { connected: false });
                res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
            } else if (errorCode === 4) {
                res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau." });
            } else if (errorCode === 100) {
                res.status(400).json({ error: "Tham số không hợp lệ trong yêu cầu Facebook" });
            } else if (errorCode === 551) {
                res.status(403).json({ error: "Hết thời gian nhắn tin 24 giờ. Vui lòng sử dụng tin nhắn được gắn thẻ." });
            } else {
                res.status(500).json({ error: "Không thể lấy tin nhắn từ Facebook", detail: err.message });
            }
        }
    });

    /**
     * Reply to a message
     * @route POST /messages/reply
     * @body {pageId, recipientId, message, conversationId}
     */
    router.post("/reply", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const logger = req.app.get("logger") as winston.Logger;
        const redis = req.app.get("redis") as Redis;
        const { pageId, recipientId, message, conversationId } = req.body as ReplyRequestBody;
        const userId = req.user?.id;

        try {
            if (!pageId || !recipientId || !message) {
                res.status(400).json({ error: "Thiếu pageId, recipientId hoặc message" });
                return;
            }

            if (!userId) {
                res.status(401).json({ error: "Không tìm thấy người dùng" });
                return;
            }

            const user = await User.findById(userId).lean();
            if (!user || !user.isActive || !user.facebookId) {
                res.status(404).json({ error: "Người dùng chưa kết nối hoặc bị khóa" });
                return;
            }

            const page = await Page.findOne({ pageId, facebookId: user.facebookId, connected: true }).lean();
            if (!page) {
                res.status(404).json({ error: "Không tìm thấy page hoặc không có quyền" });
                return;
            }

            if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
                await Page.updateOne({ pageId }, { connected: false });
                res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
                return;
            }

            const lastMessage = await Message.findOne({
                pageId,
                senderId: recipientId,
                direction: "in"
            }).sort({ timestamp: -1 }).lean();

            const effectiveConversationId = conversationId || lastMessage?.conversationId || recipientId;
            const isWithin24Hours = lastMessage && (new Date().getTime() - new Date(lastMessage.timestamp).getTime()) <= 24 * 60 * 60 * 1000;

            const payload: any = {
                recipient: { id: recipientId },
                message: { text: message },
                messaging_type: isWithin24Hours ? "RESPONSE" : "MESSAGE_TAG",
                tag: isWithin24Hours ? undefined : "ACCOUNT_UPDATE"
            };

            const response = await axios.post(`https://graph.facebook.com/v23.0/me/messages?access_token=${page.access_token}`, payload);
            const newMessageId = response.data.message_id || `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;

            const existingMessage = await Message.findOne({ id: newMessageId, pageId }).lean();
            if (existingMessage) {
                res.status(409).json({ error: "Tin nhắn đã tồn tại", message: existingMessage });
                return;
            }

            const pageInfo = await getFacebookUser(pageId, page.access_token, redis);
            const newMsg = await Message.create({
                id: newMessageId,
                facebookId: user.facebookId,
                pageId,
                senderId: pageId,
                senderName: page.name || "Page",
                recipientId,
                message,
                direction: "out",
                timestamp: new Date(),
                avatar: pageInfo?.picture?.data?.url || undefined,
                conversationId: effectiveConversationId,
                status: "sent"
            });

            const io = req.app.get("io");
            io.to(pageId).emit("fb_message", {
                id: newMessageId,
                pageId,
                conversationId: effectiveConversationId,
                senderId: pageId,
                senderName: page.name || "Page",
                recipientId,
                message,
                direction: "out",
                timestamp: newMsg.timestamp,
                avatar: pageInfo?.picture?.data?.url || undefined,
                status: "sent"
            });

            logger.info("Message sent", { messageId: newMessageId, pageId, userId });
            res.json({ success: true, message: newMsg });
        } catch (err: any) {
            logger.error("Error sending message", { error: err.message, userId });
            const errorCode = err.response?.data?.error?.code;
            if (errorCode === 190) {
                await Page.updateOne({ pageId }, { connected: false });
                res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
            } else if (errorCode === 4) {
                res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau." });
            } else if (errorCode === 100) {
                res.status(400).json({ error: "Tham số không hợp lệ trong yêu cầu Facebook" });
            } else if (errorCode === 551) {
                res.status(403).json({ error: "Hết thời gian nhắn tin 24 giờ. Vui lòng sử dụng tin nhắn được gắn thẻ." });
            } else {
                res.status(500).json({ error: "Không thể gửi tin nhắn", detail: err.message });
            }
        }
    });

    return router;
};