import express, { Request, Response } from "express";
import Message from "../models/Message";
import Page from "../models/Page";
import User from "../models/User";
import axios from "axios";

const router = express.Router();

router.post("/", async (req: Request, res: Response) => {
    try {
        const body = req.body;
        if (body.object !== "page" || !body.entry || !Array.isArray(body.entry)) {
            res.sendStatus(404);
            return;
        }
        for (const entry of body.entry) {
            const pageId = entry.id;
            for (const event of entry.messaging) {
                if (event.message && event.sender && event.recipient) {
                    const senderId = event.sender.id;
                    const recipientId = event.recipient.id;
                    const message = event.message.text || "";
                    const page = await Page.findOne({ pageId, connected: true });
                    if (!page) continue;
                    const user = await User.findOne({ facebookId: page.facebookId });
                    if (!user) continue;
                    const { data: sender } = await axios.get(`https://graph.facebook.com/${senderId}?fields=name&access_token=${page.access_token}`);
                    const newMsg = await Message.create({
                        facebookId: page.facebookId,
                        pageId,
                        senderId,
                        senderName: sender.name || "Unknown",
                        recipientId,
                        message,
                        direction: "in",
                        timestamp: new Date(),
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
                        });
                    }
                }
            }
        }
        res.sendStatus(200);
    } catch (error) {
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