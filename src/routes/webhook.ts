import express, { Request, Response } from "express";
import Message from "../models/Message";
import Page from "../models/Page";

const router = express.Router();

// Facebook webhook (tin nhắn đến)
router.post("/", async (req: Request, res: Response) => {
    try {
        const body = req.body;
        if (body.object !== "page" || !body.entry || !Array.isArray(body.entry)) {
            res.sendStatus(404);
            return;
        }
        if (body.object === "page") {
            for (const entry of body.entry) {
                const pageId = entry.id;
                for (const event of entry.messaging) {
                    if (event.message && event.sender && event.recipient) {
                        const senderId = event.sender.id;
                        const recipientId = event.recipient.id;
                        const message = event.message.text || "";
                        const page = await Page.findOne({ pageId });
                        if (!page) continue;
                        const newMsg = await Message.create({
                            pageId,
                            senderId,
                            senderName: "", // Có thể lấy thêm từ Graph API nếu cần
                            recipientId,
                            message,
                            direction: "in",
                            timestamp: new Date()
                        });
                        // Emit realtime
                        const io = req.app.get("io");
                        if (io) {
                            io.to(pageId).emit("fb_message", {
                                pageId,
                                senderId,
                                senderName: "",
                                recipientId,
                                message,
                                direction: "in",
                                timestamp: newMsg.timestamp,
                                id: newMsg._id
                            });
                        }
                    }
                }
            }
            res.sendStatus(200);
        }
    } catch (error) {
        res.sendStatus(500);
    }
});

// Facebook webhook xác thực
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