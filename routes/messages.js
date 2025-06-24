const express = require('express');
const axios = require('axios');
const Page = require('../models/Page');
const Message = require('../models/Message');

module.exports = (io) => {
    const router = express.Router();

    io.on("connection", (socket) => {
        socket.on("join", (data) => {
            socket.join(data.pageId); // Tham gia room theo pageId
            console.log(`User joined room: ${data.pageId}`);
        });

        socket.on("disconnect", () => {
            console.log("User disconnected");
        });
    });
    router.get('/', async (req, res) => {
        const messages = await Message.find().sort({ timestamp: -1 });
        res.json(messages);
    });
    router.get('/fb/:pageId', async (req, res) => {
        const { pageId } = req.params;
        try {
            const page = await Page.findOne({ pageId });
            if (!page) return res.status(404).json({ error: 'Page not found' });

            // Lấy danh sách hội thoại
            const { data: conversations } = await axios.get(
                `https://graph.facebook.com/v18.0/${pageId}/conversations`,
                { params: { access_token: page.access_token, limit: 10 } }
            );

            // Lấy tin nhắn của từng hội thoại (ví dụ: chỉ lấy hội thoại đầu tiên)
            const messagesByConversation = [];
            for (const conv of conversations.data) {
                const { data: messages } = await axios.get(
                    `https://graph.facebook.com/v18.0/${conv.id}/messages`,
                    {
                        params: {
                            access_token: page.access_token,
                            fields: 'message,from,to,created_time,attachments'
                        }
                    }
                );
                messagesByConversation.push({
                    conversationId: conv.id,
                    messages: messages.data
                });
            }

            res.json(messagesByConversation);
        } catch (err) {
            console.error('❌ FB fetch error:', err?.response?.data || err);
            res.status(500).json({ error: 'Failed to fetch messages from Facebook' });
        }
    });

    router.post('/reply', async (req, res) => {
        const { pageId, recipientId, message } = req.body;
        try {
            const page = await Page.findOne({ pageId });
            if (!page) return res.status(404).json({ error: 'Page not found' });

            await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${page.access_token}`, {
                recipient: { id: recipientId },
                message: { text: message }
            });

            await Message.create({
                pageId,
                senderId: 'page',
                recipientId,
                message,
                direction: 'out'
            });

            res.json({ success: true });
        } catch (err) {
            console.error('❌ Send error:', err?.response?.data || err);
            res.status(500).json({ error: 'Failed to send message' });
        }
    });

    return router;
};