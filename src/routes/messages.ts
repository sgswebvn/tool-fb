import express, { Request, Response, NextFunction } from "express";
import axios from "axios";
import { Server, Socket } from "socket.io"; // Nhập kiểu từ socket.io
import Page from "../models/Page";
import Message from "../models/Message";

// Định nghĩa interface cho dữ liệu từ req.body và req.params
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

// Định nghĩa interface cho dữ liệu từ Facebook API
interface FacebookConversation {
    id: string;
    // Thêm các trường khác nếu cần
}

interface FacebookMessage {
    id?: string;
    message: string;
    from: { id: string; name: string };
    to: { id: string };
    created_time: string;
    attachments?: any; // Có thể định nghĩa chi tiết hơn nếu cần
}

// Định nghĩa interface cho Socket.IO data
interface JoinData {
    pageId: string;
}

export default (io: Server) => {
    const router = express.Router();

    // Xử lý sự kiện Socket.IO
    io.on("connection", (socket: Socket) => {
        socket.on("join", (data: JoinData) => {
            socket.join(data.pageId);
        });
        socket.on("disconnect", () => {
            // Có thể thêm logic xử lý khi client ngắt kết nối
        });
    });

    // Lấy tất cả messages (có thể phân trang)
    router.get("/", async (req: Request, res: Response): Promise<void> => {
        try {
            const messages = await Message.find().sort({ timestamp: -1 });
            res.json(messages);
        } catch (error) {
            res.status(500).json({ error: "Lỗi máy chủ" });
        }
    });

    // Lấy messages từ Facebook cho page
    router.get("/fb/:pageId", async (req: Request<{ pageId: string }>, res: Response): Promise<void> => {
        const { pageId } = req.params;
        try {
            const page = await Page.findOne({ pageId });
            if (!page) {
                res.status(404).json({ error: "Không tìm thấy page" });
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
        } catch (err) {
            console.error("❌ Lỗi khi lấy tin nhắn từ Facebook:", err);
            res.status(500).json({ error: "Không thể lấy tin nhắn từ Facebook" });
        }
    });

    // Gửi tin nhắn từ page tới user
    router.post("/reply", async (req: Request<{}, {}, ReplyRequestBody>, res: Response): Promise<void> => {
        const { pageId, recipientId, message } = req.body;
        try {
            if (!pageId || !recipientId || !message) {
                res.status(400).json({ error: "Thiếu thông tin cần thiết" });
                return;
            }

            const page = await Page.findOne({ pageId });
            if (!page) {
                res.status(404).json({ error: "Không tìm thấy page" });
                return;
            }

            await axios.post(
                `https://graph.facebook.com/v18.0/me/messages?access_token=${page.access_token}`,
                {
                    messaging_type: "RESPONSE",
                    recipient: { id: recipientId },
                    message: { text: message },
                }
            );

            const newMsg = await Message.create({
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
            });

            res.json({ success: true });
        } catch (err: any) {
            console.error("❌ Lỗi khi gửi tin nhắn:", err?.response?.data || err.message || err);
            res.status(500).json({ error: "Không thể gửi tin nhắn", detail: err?.response?.data || err.message || err });
        }
    });

    // Theo dõi hội thoại
    router.post("/:messageId/follow", async (req: Request<MessageParams, {}, FollowRequestBody>, res: Response): Promise<void> => {
        const { messageId } = req.params;
        const { pageId, followed } = req.body;
        try {
            if (!pageId || followed === undefined) {
                res.status(400).json({ error: "Thiếu thông tin cần thiết" });
                return;
            }

            const message = await Message.findOneAndUpdate(
                { _id: messageId, pageId },
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