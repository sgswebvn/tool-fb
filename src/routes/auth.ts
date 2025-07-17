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

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/register", async (req: Request<{}, {}, RegisterRequestBody>, res: Response): Promise<void> => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password || !name) {
            res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
            return;
        }
        if (!emailRegex.test(email)) {
            res.status(400).json({ error: "Email không hợp lệ" });
            return;
        }
        const existing = await User.findOne({ email });
        if (existing) {
            res.status(400).json({ error: "Email đã tồn tại" });
            return;
        }
        const hash = await bcrypt.hash(password, 10);
        const user = await User.create({ email, password: hash, name, role: "user", package: "free", isActive: true });
        const token = jwt.sign({ id: user._id, username: name, role: user.role }, process.env.JWT_SECRET!, {
            expiresIn: "7d",
        });
        res.json({
            success: true,
            token,
            user: { id: user._id, email: user.email, name: user.name, role: user.role },
        });
    } catch (error: any) {
        console.error("❌ Đăng ký thất bại:", error.message);
        res.status(500).json({ error: "Đăng ký thất bại", detail: error.message });
    }
});

router.post("/login", async (req: Request<{}, {}, LoginRequestBody>, res: Response): Promise<void> => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            res.status(400).json({ error: "Thiếu email hoặc password" });
            return;
        }
        if (!emailRegex.test(email)) {
            res.status(400).json({ error: "Email không hợp lệ" });
            return;
        }
        const user = await User.findOne({ email });
        if (!user || !user.isActive) {
            res.status(400).json({ error: "Không tìm thấy tài khoản hoặc tài khoản bị khóa" });
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
    } catch (error: any) {
        console.error("❌ Đăng nhập thất bại:", error.message);
        res.status(500).json({ error: "Đăng nhập thất bại", detail: error.message });
    }
});

router.post("/forgot", async (req: Request<{}, {}, ForgotRequestBody>, res: Response): Promise<void> => {
    try {
        const { email } = req.body;
        if (!email || !emailRegex.test(email)) {
            res.status(400).json({ error: "Email không hợp lệ" });
            return;
        }
        const user = await User.findOne({ email });
        if (!user || !user.isActive) {
            res.status(400).json({ error: "Không tìm thấy tài khoản hoặc tài khoản bị khóa" });
            return;
        }
        const token = crypto.randomBytes(20).toString("hex");
        user.resetToken = token;
        user.resetTokenExpire = new Date(Date.now() + 3600 * 1000);
        await user.save();
        await sendResetMail(email, token);
        res.json({ success: true });
    } catch (error: any) {
        console.error("❌ Lỗi gửi email reset:", error.message);
        res.status(500).json({ error: "Không thể gửi email đặt lại mật khẩu", detail: error.message });
    }
});

router.post("/reset", async (req: Request<{}, {}, ResetRequestBody>, res: Response): Promise<void> => {
    try {
        const { token, password } = req.body;
        if (!token || !password) {
            res.status(400).json({ error: "Thiếu token hoặc password" });
            return;
        }
        const user = await User.findOne({ resetToken: token, resetTokenExpire: { $gt: new Date() } });
        if (!user || !user.isActive) {
            res.status(400).json({ error: "Token không hợp lệ hoặc đã hết hạn" });
            return;
        }
        user.password = await bcrypt.hash(password, 10);
        user.resetToken = undefined;
        user.resetTokenExpire = undefined;
        await user.save();
        res.json({ success: true });
    } catch (error: any) {
        console.error("❌ Đặt lại mật khẩu thất bại:", error.message);
        res.status(500).json({ error: "Đặt lại mật khẩu thất bại", detail: error.message });
    }
});

router.get("/me", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: "Không tìm thấy thông tin người dùng" });
            return;
        }
        const user = await User.findById(userId).lean();
        if (!user || !user.isActive) {
            res.status(404).json({ error: "Người dùng không tồn tại hoặc bị khóa" });
            return;
        }
        res.json({
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
            facebookId: user.facebookId,
        });
    } catch (error: any) {
        console.error("❌ Lỗi lấy thông tin người dùng:", error.message);
        res.status(500).json({ error: "Không thể lấy thông tin người dùng", detail: error.message });
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
        if (!user || !user.isActive) {
            res.status(404).json({ error: "Người dùng không tồn tại hoặc bị khóa" });
            return;
        }
        user.role = role;
        await user.save();
        res.json({ success: true, user: { id: user._id, email: user.email, name: user.name, role: user.role } });
    } catch (error: any) {
        console.error("❌ Cập nhật vai trò thất bại:", error.message);
        res.status(500).json({ error: "Cập nhật vai trò thất bại", detail: error.message });
    }
});

router.get("/facebook", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const redirectUri = process.env.FB_REDIRECT_URI || "https://api.mutifacebook.pro.vn/auth/facebook/callback";
        const scope = "pages_messaging,pages_show_list";
        const token = req.headers.authorization?.split(" ")[1] || req.query.token;
        if (!token) {
            res.status(401).json({ error: "Thiếu token xác thực" });
            return;
        }
        const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${token}`;
        res.json({ url: authUrl });
    } catch (error: any) {
        console.error("❌ Lỗi tạo URL xác thực:", error.message);
        res.status(500).json({ error: "Không thể tạo URL xác thực", detail: error.message });
    }
});

router.get("/facebook/callback", async (req: Request, res: Response): Promise<void> => {
    const code = req.query.code as string;
    const token = req.query.state as string;

    if (!token || !code) {
        res.status(401).json({ error: "Thiếu token xác thực hoặc code" });
        return;
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
        const userId = decoded.id;
        const user = await User.findById(userId);
        if (!user || !user.isActive) {
            res.status(404).json({ error: "Người dùng không tồn tại hoặc bị khóa" });
            return;
        }

        const { data: tokenData } = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
            params: {
                client_id: process.env.FB_APP_ID,
                client_secret: process.env.FB_APP_SECRET,
                redirect_uri: process.env.FB_REDIRECT_URI,
                code,
            },
        });

        const { data: fbUser } = await axios.get(`https://graph.facebook.com/me?fields=id,name,email&access_token=${tokenData.access_token}`);
        const facebookId = fbUser.id;

        await User.updateOne(
            { _id: userId },
            { facebookId, facebookAccessToken: tokenData.access_token, name: fbUser.name, email: fbUser.email || undefined },
            { upsert: true }
        );

        res.json({ success: true, redirect: "/dashboard" });
    } catch (err: any) {
        console.error("❌ Facebook login error:", err?.response?.data || err.message);
        const errorMessage = err.response?.data?.error?.message || "Kết nối Facebook thất bại";
        const errorCode = err.response?.data?.error?.code;
        if (errorCode === 100) {
            res.status(400).json({ error: "Tham số không hợp lệ trong yêu cầu Facebook", detail: errorMessage });
        } else if (errorCode === 190) {
            res.status(400).json({ error: "Token không hợp lệ", detail: errorMessage });
        } else {
            res.status(500).json({ error: "Kết nối Facebook thất bại", detail: errorMessage });
        }
    }
});

router.get("/facebook/pages", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const user = await User.findById(userId);
        if (!user || !user.isActive || !user.facebookId || !user.facebookAccessToken) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
            return;
        }
        const { data: pages } = await axios.get(`https://graph.facebook.com/me/accounts?access_token=${user.facebookAccessToken}&fields=id,name,access_token,picture`);
        if (!Array.isArray(pages.data)) {
            res.status(500).json({ error: "Dữ liệu fanpage không hợp lệ từ Facebook" });
            return;
        }
        const pageData = pages.data.map((page: any) => ({
            pageId: page.id,
            name: page.name,
            access_token: page.access_token,
            picture: page.picture?.data?.url,
        }));
        res.json(pageData);
    } catch (err: any) {
        console.error("❌ Error fetching Facebook pages:", err?.response?.data || err.message);
        const errorMessage = err.response?.data?.error?.message || "Không thể lấy danh sách Fanpage";
        const errorCode = err.response?.data?.error?.code;
        if (errorCode === 190) {
            res.status(400).json({ error: "Token không hợp lệ", detail: errorMessage });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau.", detail: errorMessage });
        } else {
            res.status(500).json({ error: errorMessage, detail: err?.response?.data?.error?.message || err.message });
        }
    }
});

router.get("/facebook/refresh", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const user = await User.findById(userId);
        if (!user || !user.isActive || !user.facebookAccessToken) {
            res.status(404).json({ error: "Người dùng chưa kết nối Facebook hoặc tài khoản bị khóa" });
            return;
        }
        const { data } = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
            params: {
                grant_type: "fb_exchange_token",
                client_id: process.env.FB_APP_ID,
                client_secret: process.env.FB_APP_SECRET,
                fb_exchange_token: user.facebookAccessToken,
            },
        });
        user.facebookAccessToken = data.access_token;
        await user.save();
        res.json({ success: true });
    } catch (err: any) {
        console.error("❌ Error refreshing access token:", err?.response?.data || err.message);
        const errorMessage = err.response?.data?.error?.message || "Không thể làm mới access token";
        const errorCode = err.response?.data?.error?.code;
        if (errorCode === 190) {
            res.status(400).json({ error: "Token không hợp lệ", detail: errorMessage });
        } else if (errorCode === 4) {
            res.status(429).json({ error: "Đã vượt quá giới hạn API. Vui lòng thử lại sau.", detail: errorMessage });
        } else {
            res.status(500).json({ error: errorMessage, detail: err?.response?.data?.error?.message || err.message });
        }
    }
});

export default router;