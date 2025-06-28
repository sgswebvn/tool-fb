import express, { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import axios from "axios";
import crypto from "crypto";
import User from "../models/User";
import Page from "../models/Page";
import { sendResetMail } from "../services/mailer";
import { authMiddleware } from "../middleware/auth";

const router = express.Router();

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

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string };
}

router.post("/register", async (req: Request<{}, {}, RegisterRequestBody>, res: Response): Promise<void> => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password || !name) {
            res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
            return;
        }
        const existing = await User.findOne({ email });
        if (existing) {
            res.status(400).json({ error: "Email đã tồn tại" });
            return;
        }
        const hash = await bcrypt.hash(password, 10);
        const user = await User.create({ email, password: hash, name });
        const token = jwt.sign({ id: user._id, username: name }, process.env.JWT_SECRET!, { expiresIn: "7d" });
        res.json({ success: true, token, user: { id: user._id, email: user.email, name: user.name } });
    } catch (error) {
        res.status(500).json({ error: "Đăng ký thất bại" });
    }
});

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
        const token = jwt.sign({ id: user._id, username: user.name }, process.env.JWT_SECRET!, { expiresIn: "7d" });
        res.json({ token, user: { id: user._id, email: user.email, name: user.name } });
    } catch (error) {
        res.status(500).json({ error: "Đăng nhập thất bại" });
    }
});

router.post("/forgot", async (req: Request<{}, {}, ForgotRequestBody>, res: Response): Promise<void> => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            res.status(400).json({ error: "Không tìm thấy tài khoản" });
            return;
        }
        const token = crypto.randomBytes(20).toString("hex");
        user.resetToken = token;
        user.resetTokenExpire = new Date(Date.now() + 3600 * 1000); // 1 giờ
        await user.save();
        await sendResetMail(email, token);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Không thể gửi email đặt lại mật khẩu" });
    }
});

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
        res.status(500).json({ error: "Đặt lại mật khẩu thất bại" });
    }
});

router.get("/facebook", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const redirectUri = process.env.FB_REDIRECT_URI || "https://backend-fb-xevu.onrender.com/auth/facebook/callback";
    const scope = "pages_messaging,pages_show_list";
    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${req.query.state}`;
    res.redirect(authUrl);
});

router.get("/me", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: "Không tìm thấy thông tin người dùng" });
            return;
        }
        const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({ error: "Người dùng không tồn tại" });
            return;
        }
        res.json({
            id: user._id,
            email: user.email,
            name: user.name,
            facebookId: user.facebookId,
        });
    } catch (error) {
        res.status(500).json({ error: "Không thể lấy thông tin người dùng" });
    }
});

router.get("/facebook/callback", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const code = req.query.code as string;
    const userId = req.user?.id;

    if (!userId) {
        res.status(401).json({ error: "Người dùng chưa đăng nhập" });
        return;
    }

    try {
        const { data: tokenData } = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
            params: {
                client_id: process.env.FB_APP_ID,
                client_secret: process.env.FB_APP_SECRET,
                redirect_uri: process.env.FB_REDIRECT_URI,
                code,
            },
        });

        // Lấy facebookId
        const { data: fbUser } = await axios.get(`https://graph.facebook.com/me?fields=id&access_token=${tokenData.access_token}`);
        const facebookId = fbUser.id;

        // Cập nhật facebookId vào User
        await User.updateOne(
            { _id: userId },
            { facebookId },
            { upsert: true }
        );

        const { data: pages } = await axios.get(`https://graph.facebook.com/me/accounts?access_token=${tokenData.access_token}`);

        for (const page of pages.data) {
            await Page.updateOne(
                { pageId: page.id, facebookId },
                {
                    facebookId,
                    pageId: page.id,
                    name: page.name,
                    access_token: page.access_token,
                    expires_in: tokenData.expires_in || 5184000,
                    connected_at: new Date(),
                },
                { upsert: true }
            );
        }

        res.redirect("http://localhost:3000/messages");
    } catch (err: any) {
        console.error("❌ Facebook login error:", err?.response?.data || err.message);
        res.status(500).json({ error: "Kết nối Facebook thất bại", detail: err?.response?.data?.error?.message || err.message });
    }
});

export default router;