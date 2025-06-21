const { Schema, model } = require('mongoose');

const pageSchema = new Schema({
    userId: String,
    pageId: String,
    name: String,
    access_token: String,
    connected_at: { type: Date, default: Date.now }
});

module.exports = model('Page', pageSchema);
