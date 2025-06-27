import express, { Request, Response } from "express";
import Comment from "../models/Comment";

const router = express.Router();

router.get("/:postId", async (req: Request<{ postId: string }>, res: Response): Promise<void> => {
    try {
        const { postId } = req.params;
        if (!postId) {
            res.status(400).json({ error: "Thiếu postId" });
            return;
        }
        const comments = await Comment.find({ postId }).sort({ created_time: -1 });
        res.json(comments);
    } catch (error) {
        res.status(500).json({ error: "Lỗi máy chủ" });
    }
});
export default router;