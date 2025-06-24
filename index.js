// 📁 index.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser');
const socketIo = require('socket.io');
const connectDB = require('./db');
const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
const webhook = require('./services/webhook');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use((req, res, next) => {
    req.io = io;
    next();
});

app.use(cors({
    origin: ['http://localhost:3000', 'https://your-frontend-domain.com'],
    credentials: true,
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

connectDB();

app.use('/auth', authRoutes);
app.use('/messages', messageRoutes(io));
app.use('/webhook', webhook);


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
