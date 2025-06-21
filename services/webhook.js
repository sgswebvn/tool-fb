const express = require('express');
const router = express.Router();
const Message = require('../models/Message');

const VERIFY_TOKEN = 'fbverify';

// 📁 webhook.js
router.get('/', (req, res) => {
    const VERIFY_TOKEN = 'fbverify';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // 👉 Kiểm tra đúng cả mode và token
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Facebook webhook verified!');
        res.status(200).send(challenge);
    } else {
        console.log('❌ Verify failed:', { mode, token });
        res.sendStatus(403);
    }
});

router.post('/', async (req, res) => {
    console.log('🔥 Webhook triggered - Raw body:', JSON.stringify(req.body, null, 2)); // ✅ thêm dòng này

    const body = req.body;

    if (body.object === 'page') {
        for (const entry of body.entry) {
            const messaging = entry.messaging?.[0];
            if (messaging?.message?.text) {
                const senderId = messaging.sender.id;
                const recipientId = messaging.recipient.id;
                const messageText = messaging.message.text;

                // Lưu tin nhắn vào DB
                await Message.create({
                    pageId: recipientId, // recipient là page
                    senderId,
                    recipientId,
                    message: messageText,
                    direction: 'in', // tin nhắn vào page
                    timestamp: new Date()
                });

                // Phát realtime nếu cần
                req.io.emit('fb_message', {
                    pageId: recipientId,
                    senderId,
                    message: messageText
                });
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        console.log('❌ Unsupported object:', body.object);
        res.sendStatus(404);
    }
});

module.exports = router;
