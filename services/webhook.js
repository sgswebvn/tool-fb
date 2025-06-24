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
            const messaging = entry.messaging;
            for (const msg of messaging) {
                if (msg.message && msg.message.text) {
                    const senderId = msg.sender.id;
                    const recipientId = msg.recipient.id;
                    const messageText = msg.message.text;

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
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        console.log('❌ Invalid webhook event:', body);
        res.sendStatus(404);
    }
});

module.exports = router;
