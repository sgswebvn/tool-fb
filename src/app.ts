import express from "express";
import cors from "cors";
import helmet from "helmet";
import bodyParser from "body-parser";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth";
import pageRoutes from "./routes/pages";
import postRoutes from "./routes/posts";
import commentRoutes from "./routes/comments";
import webhookRoutes from "./routes/webhook";
import packagesRoutes from "./routes/packages";
import usersRoutes from "./routes/users";
import paymentRoutes from "./routes/payments";
import { errorMiddleware } from "./middleware/error";

const app = express();

// Security headers
app.use(helmet());

// CORS configuration
app.use(cors({
    origin: process.env.NODE_ENV === "production"
        ? ["https://your-frontend-domain.com"]
        : ["http://localhost:3000"],
    credentials: true
}));

// Rate limiting for sensitive endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: "Quá nhiều yêu cầu, vui lòng thử lại sau 15 phút"
});
app.use("/auth", authLimiter);

// Body parsers
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use("/auth", authRoutes);
app.use("/pages", pageRoutes);
app.use("/posts", postRoutes);
app.use("/comments", commentRoutes);
app.use("/webhook", webhookRoutes);
app.use("/packages", packagesRoutes);
app.use("/users", usersRoutes);
app.use("/payments", paymentRoutes);

// Error handler (must be last)
app.use(errorMiddleware);

export default app;