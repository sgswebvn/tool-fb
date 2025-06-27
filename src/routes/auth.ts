import express, { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import axios from "axios";
import User from "../models/User";
import Page from "../models/Page";
import { sendResetMail } from "../services/mailer";

const router = express.Router();

// Định nghĩa interface cho body của request
interface RegisterRequestBody {
    email: string;
    password: string;
    name: string;
}

interface LoginRequestBody {
    email: string;
    password: string;
}

interface ForgotRequestBody {
    email: string;
}

interface ResetRequestBody {
    token: string;
    password: string;
}

// Đăng ký
router.post("/register", async (req: Request<{}, {}, RegisterRequestBody>, res: Response): Promise<void> => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password || !name) {
            res.status(400).json({ error: "Thiếu thông tin" });
            return;
        }
        const existing = await User.findOne({ email });
        if (existing) {
            res.status(400).json({ error: "Email đã tồn tại" });
            return;
        }
        const hash = await bcrypt.hash(password, 10);
        const user = await User.create({ email, password: hash, name });
        res.json({ success: true, user: { id: user._id, email: user.email, name: user.name } });
    } catch (error) {
        res.status(500).json({ error: "Lỗi máy chủ" });
    }
});

// Đăng nhập
router.post("/login", async (req: Request<{}, {}, LoginRequestBody>, res: Response): Promise<void> => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            res.status(400).json({ error: "Không tìm thấy tài khoản" });
            return;
        }
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            res.status(400).json({ error: "Sai mật khẩu" });
            return;
        }
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "secret", { expiresIn: "7d" });
        res.json({ token, user: { id: user._id, email: user.email, name: user.name } });
    } catch (error) {
        res.status(500).json({ error: "Lỗi máy chủ" });
    }
});

// Quên mật khẩu
router.post("/forgot", async (req: Request<{}, {}, ForgotRequestBody>, res: Response): Promise<void> => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            res.status(400).json({ error: "Không tìm thấy tài khoản" });
            return;
        }
        const token = Math.random().toString(36).substring(2, 15);
        user.resetToken = token;
        user.resetTokenExpire = new Date(Date.now() + 3600 * 1000);
        await user.save();
        await sendResetMail(email, token);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Lỗi máy chủ" });
    }
});

// Đặt lại mật khẩu
router.post("/reset", async (req: Request<{}, {}, ResetRequestBody>, res: Response): Promise<void> => {
    try {
        const { token, password } = req.body;
        const user = await User.findOne({ resetToken: token, resetTokenExpire: { $gt: new Date() } });
        if (!user) {
            res.status(400).json({ error: "Token không hợp lệ hoặc đã hết hạn" });
            return;
        }
        user.password = await bcrypt.hash(password, 10);
        user.resetToken = undefined;
        user.resetTokenExpire = undefined;
        await user.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Lỗi máy chủ" });
    }
});

// Kết nối Facebook (OAuth)
router.get("/facebook", (req: Request, res: Response): void => {
    const redirect_uri = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${process.env.FB_REDIRECT_URI}&scope=pages_messaging,pages_manage_posts,pages_read_engagement,pages_manage_metadata,pages_read_user_content&response_type=code`;
    res.redirect(redirect_uri);
});

// Callback Facebook OAuth
router.get("/facebook/callback", async (req: Request, res: Response): Promise<void> => {
    const code = req.query.code as string;
    try {
        const { data: tokenData } = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
            params: {
                client_id: process.env.FB_APP_ID,
                client_secret: process.env.FB_APP_SECRET,
                redirect_uri: process.env.FB_REDIRECT_URI,
                code,
            },
        });
        const { data: me } = await axios.get(`https://graph.facebook.com/me?access_token=${tokenData.access_token}`);
        const { data: pages } = await axios.get(`https://graph.facebook.com/me/accounts?access_token=${tokenData.access_token}`);

        // TODO: Lấy userId từ session/JWT nếu đã đăng nhập
        // const userId = (req as any).user.id;
        for (const page of pages.data) {
            await Page.updateOne(
                { pageId: page.id },
                {
                    // userId,
                    pageId: page.id,
                    name: page.name,
                    access_token: page.access_token,
                    connected_at: new Date(),
                },
                { upsert: true }
            );
        }
        res.redirect("http://localhost:3000/messages"); // hoặc trả về JSON nếu là API
    } catch (err) {
        console.error("❌ Facebook login error:", err);
        res.status(500).json({ error: "Facebook login failed" });
    }
});

export default router;