import express from "express";
import Page from "../models/Page";
import { Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
interface AuthenticatedRequest extends Request {
    user?: { id: string; username: string };
}

const router = express.Router();

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const pages = await Page.find();
    res.json(pages);
});

export default router;