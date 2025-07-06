import express, { Request, Response } from "express";
import Comment from "../models/Comment";

const router = express.Router();

// Lấy danh sách comment theo postId (có parent_id)
router.get("/:postId", async (req: Request<{ postId: string }>, res: Response): Promise<void> => {
    try {
        const { postId } = req.params;
        if (!postId) {
            res.status(400).json({ error: "Thiếu postId" });
            return;
        }
        const comments = await Comment.find({ postId }).sort({ created_time: 1 });
        res.json(comments);
    } catch (error) {
        res.status(500).json({ error: "Lỗi máy chủ" });
    }
});

// Tạo comment mới hoặc reply
router.post("/:postId", async (req: Request<{ postId: string }, any, { message: string; parentId?: string; from?: string }>, res: Response): Promise<void> => {
    try {
        const { postId } = req.params;
        const { message, parentId, from } = req.body;
        if (!postId || !message) {
            res.status(400).json({ error: "Thiếu thông tin" });
            return;
        }
        const comment = new Comment({
            postId,
            commentId: `${postId}_${Date.now()}`,
            message,
            from: from || "Fanpage",
            created_time: new Date().toISOString(),
            parent_id: parentId || null,
            facebookId: "manual" // hoặc lấy từ token nếu có
        });
        await comment.save();
        res.json(comment);
    } catch (error) {
        res.status(500).json({ error: "Không thể tạo comment" });
    }
});

export default router;