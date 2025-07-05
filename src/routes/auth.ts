import express, { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import axios from "axios";
import crypto from "crypto";
import User from "../models/User";
import Page from "../models/Page";
import { sendResetMail } from "../services/mailer";
import { authMiddleware, adminMiddleware } from "../middleware/auth";

const router = express.Router();

interface RegisterRequestBody {
    email: string;
    password: string;
    name: string;
    role?: "admin" | "user" | "guest";
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

interface UpdateRoleRequestBody {
    userId: string;
    role: "admin" | "user" | "guest";
}

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string; role: string };
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
        const user = await User.create({ email, password: hash, name, role: "user", package: "free" });
        const token = jwt.sign({ id: user._id, username: name }, process.env.JWT_SECRET!, {
            expiresIn: "7d",
        });
        res.json({
            success: true,
            token,
            user: { id: user._id, email: user.email, name: user.name, role: user.role },
        });
    } catch (error) {
        res.status(500).json({ error: "Đăng ký thất bại" });
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
        const token = jwt.sign({ id: user._id, username: user.name, role: user.role }, process.env.JWT_SECRET!, { expiresIn: "7d" });
        res.json({
            token,
            user: { id: user._id, email: user.email, name: user.name, role: user.role },
        });
    } catch (error) {
        res.status(500).json({ error: "Đăng nhập thất bại" });
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
        res.status(500).json({ error: "Đặt lại mật khẩu thất bại" });
    }
});

// Lấy thông tin người dùng
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
            role: user.role,
            facebookId: user.facebookId,
        });
    } catch (error) {
        res.status(500).json({ error: "Không thể lấy thông tin người dùng" });
    }
});

router.put("/role", authMiddleware, adminMiddleware, async (req: Request<{}, {}, UpdateRoleRequestBody>, res: Response): Promise<void> => {
    try {
        const { userId, role } = req.body;
        if (!userId || !role) {
            res.status(400).json({ error: "Thiếu userId hoặc role" });
            return;
        }
        if (!["admin", "user", "guest"].includes(role)) {
            res.status(400).json({ error: "Vai trò không hợp lệ" });
            return;
        }
        const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({ error: "Người dùng không tồn tại" });
            return;
        }
        user.role = role;
        await user.save();
        res.json({ success: true, user: { id: user._id, email: user.email, name: user.name, role: user.role } });
    } catch (error) {
        res.status(500).json({ error: "Cập nhật vai trò thất bại" });
    }
});

// Facebook OAuth
router.get("/facebook", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const redirectUri = process.env.FB_REDIRECT_URI || "https://tool-fb.onrender.com/auth/facebook/callback";
    const scope = "pages_messaging,pages_show_list";
    const token = req.headers.authorization?.split(" ")[1] || req.query.token;
    if (!token) {
        res.status(401).json({ error: "Thiếu token xác thực" });
        return
    }
    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${token}`;
    res.redirect(authUrl);
});

router.get("/facebook/callback", async (req: Request, res: Response): Promise<void> => {
    const code = req.query.code as string;
    const token = req.query.state as string; // Lấy token từ state

    if (!token) {
        res.status(401).json({ error: "Thiếu token xác thực" });
        return;
    }

    try {
        // Xác thực token, lấy userId
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
        const userId = decoded.id;

        // Lấy access_token Facebook
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

        // Lưu vào DB
        await User.updateOne(
            { _id: userId },
            { facebookId, facebookAccessToken: tokenData.access_token },
            { upsert: true }
        );

        res.redirect("http://localhost:3000/dashboard");
    } catch (err: any) {
        console.error("❌ Facebook login error:", err?.response?.data || err.message);
        res.status(500).json({ error: "Kết nối Facebook thất bại", detail: err?.response?.data?.error?.message || err.message });
    }
});


// Lấy danh sách Fanpage
router.get("/facebook/pages", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: "Không tìm thấy thông tin người dùng" });
            return;
        }
        const user = await User.findById(userId);
        if (!user || !user.facebookId || !user.facebookAccessToken) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook" });
            return;
        }

        const { data: pages } = await axios.get(`https://graph.facebook.com/me/accounts?access_token=${user.facebookAccessToken}`);
        res.json(
            pages.data.map((page: any) => ({
                pageId: page.id,
                name: page.name,
                access_token: page.access_token,
            }))
        );
    } catch (err: any) {
        console.error("❌ Error fetching Facebook pages:", err?.response?.data || err.message);
        res.status(500).json({ error: "Không thể lấy danh sách Fanpage", detail: err?.response?.data?.error?.message || err.message });
    }
});

export default router;