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

                console.log('📥 New message:', messageText);

                await Message.create({
                    pageId: recipientId,
                    senderId,
                    recipientId,
                    message: messageText,
                    direction: 'in',
                    timestamp: new Date()
                });

                req.io.emit('fb_message', {
                    pageId: recipientId,
                    senderId,
                    message: messageText
                });
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

module.exports = router;
