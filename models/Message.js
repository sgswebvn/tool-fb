const { Schema, model } = require('mongoose');

const messageSchema = new Schema({
    pageId: String,
    senderId: String,
    recipientId: String,
    message: String,
    direction: { type: String, enum: ['in', 'out'] },
    timestamp: { type: Date, default: Date.now }
});

module.exports = model('Message', messageSchema);
