import express, { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Redis from "ioredis";
import validator from "validator";
import axios from "axios";
import winston from "winston";
import User from "../models/User";
import Package from "../models/Package";
import rateLimit from "express-rate-limit";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string; role: string };
}

interface RegisterBody {
    name: string;
    email: string;
    password: string;
}

interface LoginBody {
    email: string;
    password: string;
}

interface FacebookLoginBody {
    accessToken: string;
}

const router = express.Router();

// Rate limiter for login and register endpoints
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per window
    message: "Quá nhiều yêu cầu đăng nhập. Vui lòng thử lại sau 15 phút.",
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Limit each IP to 5 requests per window
    message: "Quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau 1 giờ.",
});

/**
 * Register new user
 * @route POST /auth/register
 * @body {name, email, password}
 */
router.post("/register", registerLimiter, async (req: Request, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { name, email, password } = req.body as RegisterBody;

    try {
        // Input validation
        if (!name || !email || !password) {
            res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
            return;
        }

        if (!validator.isEmail(email)) {
            res.status(400).json({ error: "Email không hợp lệ" });
            return;
        }

        if (password.length < 6) {
            res.status(400).json({ error: "Mật khẩu phải có ít nhất 6 ký tự" });
            return;
        }

        if (name.length < 2 || name.length > 50) {
            res.status(400).json({ error: "Tên phải từ 2 đến 50 ký tự" });
            return;
        }

        const existingUser = await User.findOne({ email }).lean();
        if (existingUser) {
            res.status(400).json({ error: "Email đã được sử dụng" });
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({
            name,
            email,
            password: hashedPassword,
            role: "user",
            package: "basic",
            isActive: true,
        });
        await user.save();

        const token = jwt.sign(
            { id: user._id, username: user.name, role: user.role },
            process.env.JWT_SECRET || "default-secret-key",
            { expiresIn: "1h" }
        );

        const refreshToken = jwt.sign(
            { id: user._id },
            process.env.JWT_REFRESH_SECRET || "default-refresh-secret",
            { expiresIn: "7d" }
        );

        await redis.setex(`refresh_token:${user._id}`, 7 * 24 * 60 * 60, refreshToken); // Cache refresh token for 7 days

        logger.info("User registered", { userId: user._id, email });
        res.status(201).json({ token, refreshToken, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (error: any) {
        logger.error("Error registering user", { error: error.message, email });
        res.status(500).json({ error: "Không thể đăng ký người dùng", detail: error.message });
    }
});

/**
 * Login user
 * @route POST /auth/login
 * @body {email, password}
 */
router.post("/login", loginLimiter, async (req: Request, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { email, password } = req.body as LoginBody;

    try {
        if (!email || !password) {
            res.status(400).json({ error: "Thiếu email hoặc mật khẩu" });
            return;
        }

        const user = await User.findOne({ email }).select("+password").lean();
        if (!user || !user.isActive) {
            res.status(401).json({ error: "Email hoặc mật khẩu không đúng, hoặc tài khoản bị khóa" });
            return;
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });
            return;
        }

        const token = jwt.sign(
            { id: user._id, username: user.name, role: user.role },
            process.env.JWT_SECRET || "default-secret-key",
            { expiresIn: "1h" }
        );

        const refreshToken = jwt.sign(
            { id: user._id },
            process.env.JWT_REFRESH_SECRET || "default-refresh-secret",
            { expiresIn: "7d" }
        );

        await redis.setex(`refresh_token:${user._id}`, 7 * 24 * 60 * 60, refreshToken); // Cache refresh token for 7 days

        logger.info("User logged in", { userId: user._id, email });
        res.json({ token, refreshToken, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (error: any) {
        logger.error("Error logging in user", { error: error.message, email });
        res.status(500).json({ error: "Không thể đăng nhập", detail: error.message });
    }
});

/**
 * Refresh JWT token
 * @route POST /auth/refresh
 * @body {refreshToken}
 */
router.post("/refresh", async (req: Request, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { refreshToken } = req.body;

    try {
        if (!refreshToken) {
            res.status(400).json({ error: "Thiếu refreshToken" });
            return;
        }

        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || "default-refresh-secret") as { id: string };
        const cachedToken = await redis.get(`refresh_token:${decoded.id}`);
        if (cachedToken !== refreshToken) {
            res.status(401).json({ error: "Refresh token không hợp lệ hoặc đã hết hạn" });
            return;
        }

        const user = await User.findById(decoded.id).lean();
        if (!user || !user.isActive) {
            res.status(401).json({ error: "Người dùng không tồn tại hoặc bị khóa" });
            return;
        }

        const newToken = jwt.sign(
            { id: user._id, username: user.name, role: user.role },
            process.env.JWT_SECRET || "default-secret-key",
            { expiresIn: "1h" }
        );

        logger.info("Token refreshed", { userId: user._id });
        res.json({ token: newToken });
    } catch (error: any) {
        logger.error("Error refreshing token", { error: error.message });
        res.status(401).json({ error: "Không thể làm mới token", detail: error.message });
    }
});

/**
 * Facebook login
 * @route POST /auth/facebook
 * @body {accessToken}
 */
router.post("/facebook", async (req: Request, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { accessToken } = req.body as FacebookLoginBody;

    try {
        if (!accessToken) {
            res.status(400).json({ error: "Thiếu accessToken" });
            return;
        }

        // Verify Facebook access token
        const { data } = await axios.get(`https://graph.facebook.com/me?access_token=${accessToken}&fields=id,name,email`);
        if (!data.id || !data.email) {
            res.status(400).json({ error: "Access token không hợp lệ" });
            return;
        }

        let user = await User.findOne({ facebookId: data.id });
        if (!user) {
            user = await User.findOne({ email: data.email });
            if (user) {
                // Link existing user with Facebook
                user.facebookId = data.id;
                user.facebookAccessToken = accessToken;
                await user.save();
            } else {
                // Create new user
                const defaultPackage = await Package.findOne({ name: "basic" }).lean();
                if (!defaultPackage) {
                    res.status(500).json({ error: "Gói dịch vụ mặc định không tồn tại" });
                    return;
                }

                user = new User({
                    name: data.name,
                    email: data.email,
                    password: await bcrypt.hash(Math.random().toString(36).slice(2), 10), // Random password
                    facebookId: data.id,
                    facebookAccessToken: accessToken,
                    role: "user",
                    package: "basic",
                    isActive: true,
                });
                await user.save();
            }
        }

        if (!user.isActive) {
            res.status(403).json({ error: "Tài khoản bị khóa" });
            return;
        }

        const token = jwt.sign(
            { id: user._id, username: user.name, role: user.role },
            process.env.JWT_SECRET || "default-secret-key",
            { expiresIn: "1h" }
        );

        const refreshToken = jwt.sign(
            { id: user._id },
            process.env.JWT_REFRESH_SECRET || "default-refresh-secret",
            { expiresIn: "7d" }
        );

        await redis.setex(`refresh_token:${user._id}`, 7 * 24 * 60 * 60, refreshToken); // Cache refresh token for 7 days

        logger.info("Facebook login successful", { userId: user._id, email: user.email });
        res.json({ token, refreshToken, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (error: any) {
        logger.error("Error in Facebook login", { error: error.message });
        const errorCode = error.response?.data?.error?.code;
        if (errorCode === 190) {
            res.status(400).json({ error: "Access token không hợp lệ hoặc đã hết hạn" });
        } else {
            res.status(500).json({ error: "Không thể đăng nhập qua Facebook", detail: error.message });
        }
    }
});

export default router;