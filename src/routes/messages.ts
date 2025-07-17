import express, { Request, Response } from "express";
import axios from "axios";
import { Server, Socket } from "socket.io";
import Page from "../models/Page";
import Message from "../models/Message";
import User from "../models/User";
import { authMiddleware } from "../middleware/auth";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string };
}

interface ReplyRequestBody {
    pageId: string;
    recipientId: string;
    message: string;
}

interface FollowRequestBody {
    pageId: string;
    followed: boolean;
}

interface MessageParams {
    messageId: string;
}

interface FacebookConversation {
    id: string;
}

interface FacebookMessage {
    id?: string;
    message: string;
    from: { id: string; name: string };
    to: { id: string };
    created_time: string;
    attachments?: any;
}

interface JoinData {
    pageId: string;
}

const userInfoCache: { [key: string]: any } = {};

async function getFacebookUserInfo(senderId: string, accessToken: string) {
    if (userInfoCache[senderId]) {
        return userInfoCache[senderId];
    }
    try {
        const { data } = await axios.get(
            `https://graph.facebook.com/v18.0/${senderId}`,
            {
                params: {
                    fields: "id,name,gender,picture",
                    access_token: accessToken,
                },
            }
        );
        userInfoCache[senderId] = data;
        setTimeout(() => delete userInfoCache[senderId], 3600 * 1000);
        return data;
    } catch {
        return null;
    }
}

export default (io: Server) => {
    const router = express.Router();

    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error("Authentication error"));
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "default-secret-key") as any;
            socket.data.user = decoded;
            next();
        } catch (err) {
            next(new Error("Invalid token"));
        }
    });

    io.on("connection", (socket: Socket) => {
        socket.on("join", async (data: JoinData) => {
            try {
                const userId = socket.data.user?.id;
                if (!data.pageId || !/^[0-9_]+$/.test(data.pageId)) {
                    socket.emit("error", { error: "pageId không hợp lệ" });
                    return;
                }
                const user = await User.findById(userId).lean();
                if (!user || !user.isActive || !user.facebookId) {
                    socket.emit("error", { error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
                    return;
                }
                const page = await Page.findOne({ pageId: data.pageId, facebookId: user.facebookId, connected: true });
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
                socket.emit("joined", { pageId: data.pageId });
            } catch (err: any) {
                console.error("❌ Lỗi khi tham gia room:", err.message);
                socket.emit("error", { error: "Lỗi khi tham gia room", detail: err.message });
            }
        });
    });

    router.get("/", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: "Không tìm thấy thông tin người dùng" });
                return;
            }
            const user = await User.findById(userId).lean();
            if (!user || !user.isActive || !user.facebookId) {
                res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
                return;
            }
            const messages = await Message.find({ facebookId: user.facebookId }).sort({ timestamp: -1 }).lean();
            res.json(messages);
        } catch (error: any) {
            console.error("❌ Lỗi lấy tin nhắn:", error.message);
            res.status(500).json({ error: "Lỗi máy chủ", detail: error.message });
        }
    });

    router.get("/fb/:pageId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const { pageId } = req.params;
        const { limit = 10, skip = 0 } = req.query;
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
                res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
                return;
            }
            const page = await Page.findOne({ pageId, facebookId: user.facebookId, connected: true });
            if (!page) {
                res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền truy cập" });
                return;
            }
            if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
                await Page.updateOne({ pageId }, { connected: false });
                res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
                return;
            }
            const { data: conversations } = await axios.get<{ data: FacebookConversation[] }>(
                `https://graph.facebook.com/v18.0/${pageId}/conversations`,
                { params: { access_token: page.access_token, limit: Number(limit), offset: Number(skip) } }
            );
            if (!Array.isArray(conversations.data)) {
                res.status(500).json({ error: "Dữ liệu hội thoại không hợp lệ từ Facebook" });
                return;
            }
            const messagesByConversation = await Promise.all(
                conversations.data.map(async (conv: FacebookConversation) => {
                    const { data: messages } = await axios.get<{ data: FacebookMessage[] }>(
                        `https://graph.facebook.com/v18.0/${conv.id}/messages`,
                        {
                            params: {
                                access_token: page.access_token,
                                fields: "message,from,to,created_time,attachments",
                                limit: 20,
                            },
                        }
                    );
                    if (!Array.isArray(messages.data)) {
                        return { conversationId: conv.id, customerInfo: null, messages: [] };
                    }
                    const customerMsg = messages.data.find((msg: FacebookMessage) => msg.from.id !== pageId);
                    let customerInfo = null;
                    if (customerMsg) {
                        customerInfo = await getFacebookUserInfo(customerMsg.from.id, page.access_token);
                    }
                    const messageData = await Promise.all(
                        messages.data.map(async (msg: FacebookMessage) => {
                            if (!msg.message) return null;
                            const userInfo = await getFacebookUserInfo(msg.from.id, page.access_token);
                            const avatar = userInfo?.picture?.data?.url || null;
                            const messageId = msg.id || uuidv4();
                            const existingMessage = await Message.findOne({ id: messageId, pageId }).lean();
                            if (!existingMessage) {
                                await Message.create({
                                    id: messageId,
                                    senderId: msg.from.id,
                                    senderName: msg.from.name,
                                    recipientId: msg.to.id,
                                    message: msg.message,
                                    timestamp: msg.created_time,
                                    direction: msg.from.id === pageId ? "out" : "in",
                                    facebookId: user.facebookId,
                                    pageId,
                                    avatar,
                                    conversationId: conv.id,
                                });
                            }
                            return {
                                id: messageId,
                                senderId: msg.from.id,
                                senderName: msg.from.name,
                                recipientId: msg.to.id,
                                message: msg.message,
                                timestamp: msg.created_time,
                                direction: msg.from.id === pageId ? "out" : "in",
                                avatar,
                                followed: existingMessage?.followed || false, // Bao gồm trạng thái followed
                            };
                        })
                    );
                    return {
                        conversationId: conv.id,
                        customerInfo: customerInfo
                            ? {
                                id: customerInfo.id,
                                name: customerInfo.name,
                                picture: customerInfo.picture?.data?.url || null,
                            }
                            : null,
                        messages: messageData.filter((msg) => msg !== null).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
                    };
                })
            );
            res.json(messagesByConversation);
        } catch (err: any) {
            console.error("❌ Lỗi khi lấy tin nhắn từ Facebook:", err?.response?.data || err.message);
            const errorMessage = err.response?.data?.error?.message || "Không thể lấy tin nhắn từ Facebook";
            const errorCode = err.response?.data?.error?.code;
            if (errorCode === 190) {
                await Page.updateOne({ pageId }, { connected: false });
                res.status(400).json({
                    error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook.",
                    detail: errorMessage,
                });
            } else if (errorCode === 4) {
                res.status(429).json({
                    error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau.",
                    detail: errorMessage,
                });
            } else if (errorCode === 100) {
                res.status(400).json({
                    error: "Tham số không hợp lệ trong yêu cầu Facebook",
                    detail: errorMessage,
                });
            } else if (errorCode === 551) {
                res.status(403).json({
                    error: "Hết thời gian nhắn tin 24 giờ. Vui lòng sử dụng tin nhắn được gắn thẻ.",
                    detail: errorMessage,
                });
            } else {
                res.status(500).json({ error: errorMessage, detail: err?.response?.data?.error?.message || err.message });
            }
        }
    });

    router.post("/reply", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const { pageId, recipientId, message } = req.body as ReplyRequestBody;
        const userId = req.user?.id;

        try {
            if (!pageId || !recipientId || !message) {
                res.status(400).json({ error: "Thiếu thông tin cần thiết" });
                return;
            }
            if (!userId) {
                res.status(401).json({ error: "Không tìm thấy thông tin người dùng" });
                return;
            }
            const user = await User.findById(userId).lean();
            if (!user || !user.isActive || !user.facebookId) {
                res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
                return;
            }
            const page = await Page.findOne({ pageId, facebookId: user.facebookId, connected: true });
            if (!page) {
                res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền truy cập" });
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
                direction: "in",
            }).sort({ timestamp: -1 });
            const conversationId = lastMessage?.conversationId || recipientId; // Fallback nếu không có
            const isWithin24Hours = lastMessage && (new Date().getTime() - new Date(lastMessage.timestamp).getTime()) <= 24 * 60 * 60 * 1000;
            const payload: any = {
                recipient: { id: recipientId },
                message: { text: message },
                messaging_type: isWithin24Hours ? "RESPONSE" : "MESSAGE_TAG",
                tag: isWithin24Hours ? undefined : "ACCOUNT_UPDATE",
            };
            const response = await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${page.access_token}`, payload);
            const newMessageId = response.data.message_id || uuidv4();
            const pageInfo = await getFacebookUserInfo(pageId, page.access_token);
            const existingMessage = await Message.findOne({ id: newMessageId, pageId });
            if (!existingMessage) {
                const newMsg = await Message.create({
                    id: newMessageId,
                    facebookId: user.facebookId,
                    pageId,
                    senderId: pageId,
                    senderName: page.name || "Page",
                    recipientId,
                    message,
                    direction: "out",
                    timestamp: new Date().toISOString(),
                    avatar: pageInfo?.picture?.data?.url || null,
                    conversationId,
                });
                io.to(pageId).emit("fb_message", {
                    id: newMessageId,
                    pageId,
                    conversationId,
                    senderId: pageId,
                    senderName: page.name || "Page",
                    recipientId,
                    message,
                    direction: "out",
                    timestamp: newMsg.timestamp,
                    avatar: pageInfo?.picture?.data?.url || null,
                });
                res.json({ success: true, message: newMsg });
            } else {
                res.json({ success: false, error: "Tin nhắn đã tồn tại", message: existingMessage });
            }
        } catch (err: any) {
            console.error("❌ Lỗi khi gửi tin nhắn:", err?.response?.data || err.message);
            const errorMessage = err.response?.data?.error?.message || "Không thể gửi tin nhắn";
            const errorCode = err.response?.data?.error?.code;
            if (errorCode === 190) {
                await Page.updateOne({ pageId }, { connected: false });
                res.status(400).json({
                    error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook.",
                    detail: errorMessage,
                });
            } else if (errorCode === 4) {
                res.status(429).json({
                    error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau.",
                    detail: errorMessage,
                });
            } else if (errorCode === 100) {
                res.status(400).json({
                    error: "Tham số không hợp lệ trong yêu cầu Facebook",
                    detail: errorMessage,
                });
            } else if (errorCode === 551) {
                res.status(403).json({
                    error: "Hết thời gian nhắn tin 24 giờ. Vui lòng sử dụng tin nhắn được gắn thẻ.",
                    detail: errorMessage,
                });
            } else if (errorCode === 200) {
                res.status(403).json({
                    error: "Quyền truy cập không đủ hoặc token không hợp lệ.",
                    detail: errorMessage,
                });
            } else {
                res.status(500).json({ error: errorMessage, detail: err?.response?.data?.error?.message || err.message });
            }
        }
    });

    router.post("/:messageId/follow", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const { messageId } = req.params;
        const { pageId, followed } = req.body as FollowRequestBody;
        const userId = req.user?.id;

        try {
            if (!messageId || !pageId || followed === undefined) {
                res.status(400).json({ error: "Thiếu messageId, pageId hoặc followed" });
                return;
            }
            if (!userId) {
                res.status(401).json({ error: "Không tìm thấy thông tin người dùng" });
                return;
            }
            const user = await User.findById(userId).lean();
            if (!user || !user.isActive || !user.facebookId) {
                res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
                return;
            }
            const page = await Page.findOne({ pageId, facebookId: user.facebookId, connected: true });
            if (!page) {
                res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền truy cập" });
                return;
            }
            if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
                await Page.updateOne({ pageId }, { connected: false });
                res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
                return;
            }
            const message = await Message.findOneAndUpdate(
                { id: messageId, pageId, facebookId: user.facebookId },
                { followed },
                { new: true, lean: true }
            );
            if (!message) {
                res.status(404).json({ error: "Không tìm thấy tin nhắn" });
                return;
            }
            io.to(pageId).emit("fb_message_followed", { messageId, followed });
            res.json({ success: true, message });
        } catch (error: any) {
            console.error("❌ Lỗi khi cập nhật trạng thái theo dõi:", error.message);
            res.status(500).json({ error: "Không thể cập nhật trạng thái theo dõi", detail: error.message });
        }
    });

    return router;
};