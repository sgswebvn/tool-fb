import "dotenv/config";
import http from "http";
import { Server, Socket } from "socket.io";
import mongoose from "mongoose";
import Redis from "ioredis";
import winston from "winston";
import app from "./app";
import messageRoutes, { setupSocketHandlers } from "./routes/messages";
import logger from "./logger"; // Import logger

// Initialize Redis
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
redis.on("connect", () => logger.info("✅ Redis connected"));
redis.on("error", () => logger.error("Redis error"));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: process.env.NODE_ENV === "production" ? "http://localhost:3000" : "*" },
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true
    }
});

app.set("io", io);
app.set("redis", redis);
app.set("logger", logger);
app.use("/messages", messageRoutes(io));

// Set up socket connection and handlers
io.on("connection", (socket: Socket) => {
    setupSocketHandlers(socket); // Set up socket event handlers
    logger.info("A user connected", { userId: socket.data?.user?.id });
});

const PORT = process.env.PORT || 3002;

mongoose.connect(process.env.MONGO_URI as string).then(() => {
    logger.info("✅ MongoDB connected");
    server.listen(PORT, () => {
        logger.info(`🚀 Server running at http://localhost:${PORT}`);
    });
}).catch((err) => {
    logger.error("❌ MongoDB connection error", { error: err.message });
    process.exit(1);
});