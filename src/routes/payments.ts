import express, { Request, Response } from "express";
import PayOS from "@payos/node";
import Redis from "ioredis";
import User from "../models/User";
import Package from "../models/Package";
import { authMiddleware } from "../middleware/auth";
import winston from "winston";
import crypto from "crypto";

interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string; role: string };
}

interface CreatePaymentBody {
    packageId: string;
    amount: number;
    description?: string;
}

interface PaymentWebhookBody {
    orderCode: number; // Updated: orderCode is a number
    status: "PAID" | "CANCELLED" | "PENDING";
    transactionId: string;
    amount: number;
}

const router = express.Router();

const payos = new PayOS(
    process.env.PAYOS_CLIENT_ID || "",
    process.env.PAYOS_API_KEY || "",
    process.env.PAYOS_CHECKSUM_KEY || ""
);

/**
 * Generate unique order code as a number
 */
function generateOrderCode(): number {
    return Date.now(); // Use timestamp as a unique numeric order code
}

function generateSignature(webhookData: PaymentWebhookBody): string {
    const { orderCode, status, amount, transactionId } = webhookData;
    const dataString = `amount=${amount}&orderCode=${orderCode}&status=${status}&transactionId=${transactionId}`;
    return crypto
        .createHmac("sha256", process.env.PAYOS_CHECKSUM_KEY || "")
        .update(dataString)
        .digest("hex");
}

/**
 * Create payment link for package purchase
 * @route POST /payments/create
 * @body {packageId, amount, description}
 */
router.post("/create", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { packageId, amount, description } = req.body as CreatePaymentBody;

    try {
        if (!packageId || !amount) {
            res.status(400).json({ error: "Thiếu packageId hoặc amount" });
            return;
        }

        const user = await User.findById(req.user?.id);
        if (!user || !user.isActive) {
            res.status(404).json({ error: "Người dùng không tồn tại hoặc bị khóa" });
            return;
        }

        const pkg = await Package.findById(packageId).lean();
        if (!pkg) {
            res.status(404).json({ error: "Không tìm thấy gói dịch vụ" });
            return;
        }

        if (pkg.price !== amount) {
            res.status(400).json({ error: "Số tiền không khớp với giá gói dịch vụ" });
            return;
        }

        const orderCode = generateOrderCode();
        const paymentData = {
            orderCode,
            amount,
            description: description || `Thanh toán gói ${pkg.name} cho người dùng ${user.email}`,
            items: [{ name: pkg.name, quantity: 1, price: amount }],
            returnUrl: process.env.PAYOS_RETURN_URL || "http://localhost:3000/payment/success",
            cancelUrl: process.env.PAYOS_CANCEL_URL || "http://localhost:3000/payment/cancel",
        };

        const paymentLink = await payos.createPaymentLink(paymentData);

        // Cache pending payment
        await redis.setex(`payment:${orderCode}`, 3600, JSON.stringify({
            userId: user._id,
            packageId: pkg._id,
            amount,
            status: "PENDING",
        }));

        logger.info("Payment link created", { userId: req.user?.id, orderCode, packageId });
        res.json({ paymentUrl: paymentLink.checkoutUrl, orderCode });
    } catch (error: any) {
        logger.error("Error creating payment link", { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: "Không thể tạo link thanh toán", detail: error.message });
    }
});

/**
 * Handle PayOS webhook
 * @route POST /payments/webhook
 * @body PayOS webhook data
 */
router.post("/webhook", async (req: Request, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const webhookData = req.body.data as PaymentWebhookBody;

    try {
        if (!webhookData || !webhookData.orderCode) {
            res.status(400).json({ error: "Thiếu dữ liệu webhook" });
            return;
        }

        // Verify webhook signature
        const signature = generateSignature(webhookData);
        if (signature !== req.body.signature) {
            res.status(400).json({ error: "Chữ ký webhook không hợp lệ" });
            return;
        }

        const cachedPayment = await redis.get(`payment:${webhookData.orderCode}`);
        if (!cachedPayment) {
            res.status(404).json({ error: "Không tìm thấy thông tin thanh toán" });
            return;
        }

        const paymentInfo = JSON.parse(cachedPayment);
        if (webhookData.status === "PAID" && paymentInfo.status === "PENDING") {
            const user = await User.findById(paymentInfo.userId);
            if (!user) {
                res.status(404).json({ error: "Không tìm thấy người dùng" });
                return;
            }

            const pkg = await Package.findById(paymentInfo.packageId);
            if (!pkg) {
                res.status(404).json({ error: "Không tìm thấy gói dịch vụ" });
                return;
            }

            user.package = pkg.name;
            user.packageExpiry = pkg.duration ? new Date(Date.now() + pkg.duration * 24 * 60 * 60 * 1000) : undefined;
            await user.save();

            // Update payment status in cache
            await redis.setex(`payment:${webhookData.orderCode}`, 3600, JSON.stringify({
                ...paymentInfo,
                status: "PAID",
                transactionId: webhookData.transactionId,
            }));

            logger.info("Payment completed", { userId: user._id, orderCode: webhookData.orderCode, package: pkg.name });
        } else if (webhookData.status === "CANCELLED") {
            await redis.del(`payment:${webhookData.orderCode}`);
            logger.info("Payment cancelled", { orderCode: webhookData.orderCode });
        }

        res.json({ success: true });
    } catch (error: any) {
        logger.error("Error handling payment webhook", { error: error.message, orderCode: webhookData.orderCode });
        res.status(500).json({ error: "Không thể xử lý webhook", detail: error.message });
    }
});

/**
 * Check payment status
 * @route GET /payments/status/:orderCode
 */
router.get("/status/:orderCode", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const logger = req.app.get("logger") as winston.Logger;
    const redis = req.app.get("redis") as Redis;
    const { orderCode } = req.params;

    try {
        const cachedPayment = await redis.get(`payment:${orderCode}`);
        if (!cachedPayment) {
            res.status(404).json({ error: "Không tìm thấy thông tin thanh toán" });
            return;
        }

        const paymentInfo = JSON.parse(cachedPayment);
        if (paymentInfo.userId !== req.user?.id && req.user?.role !== "admin") {
            res.status(403).json({ error: "Không có quyền truy cập" });
            return;
        }

        logger.info("Payment status checked", { userId: req.user?.id, orderCode });
        res.json(paymentInfo);
    } catch (error: any) {
        logger.error("Error checking payment status", { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: "Không thể kiểm tra trạng thái thanh toán", detail: error.message });
    }
});

export default router;