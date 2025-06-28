import express, { Request, Response } from "express";
import axios from "axios";
import { Server, Socket } from "socket.io";
import Page from "../models/Page";
import Message from "../models/Message";
import User from "../models/User";
import { authMiddleware } from "../middleware/auth";

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

export default (io: Server) => {
    const router = express.Router();

    io.on("connection", (socket: Socket) => {
        socket.on("join", (data: JoinData) => {
            socket.join(data.pageId);
        });
        socket.on("disconnect", () => { });
    });

    router.get("/", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: "Không tìm thấy thông tin người dùng" });
                return;
            }
            const user = await User.findById(userId);
            if (!user || !user.facebookId) {
                res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
                return;
            }
            const messages = await Message.find({ facebookId: user.facebookId }).sort({ timestamp: -1 });
            res.json(messages);
        } catch (error) {
            res.status(500).json({ error: "Lỗi máy chủ" });
        }
    });

    router.get("/fb/:pageId", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const { pageId } = req.params;
        const userId = req.user?.id;

        try {
            if (!userId) {
                res.status(401).json({ error: "Không tìm thấy thông tin người dùng" });
                return;
            }
            const user = await User.findById(userId);
            if (!user || !user.facebookId) {
                res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
                return;
            }
            const page = await Page.findOne({ pageId, facebookId: user.facebookId });
            if (!page) {
                res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền truy cập" });
                return;
            }

            if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
                res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
                return;
            }

            const { data: conversations } = await axios.get<{ data: FacebookConversation[] }>(
                `https://graph.facebook.com/v18.0/${pageId}/conversations`,
                { params: { access_token: page.access_token, limit: 10 } }
            );

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
                    return {
                        conversationId: conv.id,
                        messages: messages.data.map((msg: FacebookMessage, index: number) => ({
                            id: msg.id || `${conv.id}_${index}`,
                            senderId: msg.from.id,
                            senderName: msg.from.name,
                            recipientId: msg.to.id,
                            message: msg.message,
                            timestamp: msg.created_time,
                            direction: msg.from.id === pageId ? "out" : "in",
                        })),
                    };
                })
            );

            res.json(messagesByConversation);
        } catch (err: any) {
            console.error("❌ Lỗi khi lấy tin nhắn từ Facebook:", err?.response?.data || err.message);
            res.status(500).json({ error: "Không thể lấy tin nhắn từ Facebook", detail: err?.response?.data?.error?.message || err.message });
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
            const user = await User.findById(userId);
            if (!user || !user.facebookId) {
                res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
                return;
            }
            const page = await Page.findOne({ pageId, facebookId: user.facebookId });
            if (!page) {
                res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền truy cập" });
                return;
            }

            if (page.expires_in && new Date().getTime() > new Date(page.connected_at).getTime() + page.expires_in * 1000) {
                res.status(400).json({ error: "Token của trang đã hết hạn. Vui lòng kết nối lại qua Facebook." });
                return;
            }

            const lastMessage = await Message.findOne({
                pageId,
                senderId: recipientId,
                direction: "in",
            }).sort({ timestamp: -1 });

            const isWithin24Hours = lastMessage && (new Date().getTime() - new Date(lastMessage.timestamp).getTime()) <= 24 * 60 * 60 * 1000;

            const payload: any = {
                recipient: { id: recipientId },
                message: { text: message },
            };

            if (!isWithin24Hours) {
                payload.messaging_type = "MESSAGE_TAG";
                payload.tag = "ACCOUNT_UPDATE";
            } else {
                payload.messaging_type = "RESPONSE";
            }

            await axios.post(
                `https://graph.facebook.com/v18.0/me/messages?access_token=${page.access_token}`,
                payload
            );

            const newMsg = await Message.create({
                facebookId: user.facebookId,
                pageId,
                senderId: "page",
                senderName: page.name || "Page",
                recipientId,
                message,
                direction: "out",
                timestamp: new Date(),
            });

            io.to(pageId).emit("fb_message", {
                pageId,
                senderId: "page",
                senderName: page.name || "Page",
                recipientId,
                message,
                direction: "out",
                timestamp: newMsg.timestamp,
                id: newMsg._id,
            });

            res.json({ success: true });
        } catch (err: any) {
            console.error("❌ Lỗi khi gửi tin nhắn:", err?.response?.data || err.message);
            const errorMessage = err.response?.data?.error?.message || "Không thể gửi tin nhắn";
            const errorCode = err.response?.data?.error?.code;
            if (errorCode === 10) {
                res.status(400).json({
                    error: "Không thể gửi tin nhắn: Ngoài cửa sổ 24 giờ hoặc không được phép.",
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
        const messageId = req.params.messageId;
        const { pageId, followed } = req.body as FollowRequestBody;
        const userId = req.user?.id;

        try {
            if (!messageId) {
                res.status(400).json({ error: "Thiếu messageId trong params" });
                return;
            }
            if (!pageId || followed === undefined) {
                res.status(400).json({ error: "Thiếu thông tin cần thiết" });
                return;
            }
            if (!userId) {
                res.status(401).json({ error: "Không tìm thấy thông tin người dùng" });
                return;
            }
            const user = await User.findById(userId);
            if (!user || !user.facebookId) {
                res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
                return;
            }
            const page = await Page.findOne({ pageId, facebookId: user.facebookId });
            if (!page) {
                res.status(404).json({ error: "Không tìm thấy page hoặc bạn không có quyền truy cập" });
                return;
            }

            const message = await Message.findOneAndUpdate(
                { _id: messageId, pageId, facebookId: user.facebookId },
                { followed },
                { new: true }
            );
            if (!message) {
                res.status(404).json({ error: "Không tìm thấy tin nhắn" });
                return;
            }
            res.json(message);
        } catch (err) {
            res.status(500).json({ error: "Không thể cập nhật trạng thái theo dõi" });
        }
    });

    return router;
};