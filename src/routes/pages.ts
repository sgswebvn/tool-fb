import express from "express";
import Page from "../models/Page";
import { Request, Response } from "express";

const router = express.Router();

router.get("/", async (req: Request, res: Response) => {
    const pages = await Page.find();
    res.json(pages);
});

export default router;