import express, { Request, Response } from "express";
import axios from "axios";
import Page from "../models/Page";
import Post from "../models/Post";
import Comment from "../models/Comment";
import { authMiddleware } from "../middleware/auth";

// Định nghĩa interface cho req.params
interface PostParams {
  pageId: string;
  postId?: string;
}

// Định nghĩa interface cho dữ liệu từ Facebook API
interface FacebookPost {
  id: string;
  message?: string;
  created_time: string;
  full_picture?: string;
  attachments?: {
    data: Array<{
      media?: {
        image?: {
          src: string;
          height?: number;
          width?: number;
        };
      };
      subattachments?: {
        data: Array<{
          media: {
            image: {
              src: string;
              height?: number;
              width?: number;
            };
          };
        }>;
      };
    }>;
  };
}

interface FacebookComment {
  id: string;
  message: string;
  from: { id: string; name: string };
  created_time: string;
  parent?: { id: string };
}

const router = express.Router();

// Lấy post của page
router.get("/:pageId", async (req: Request<PostParams>, res: Response): Promise<void> => {
  try {
    const { pageId } = req.params;
    const { limit = 10, offset = 0 } = req.query;

    if (!pageId) {
      res.status(400).json({ error: "Thiếu pageId" });
      return;
    }

    const page = await Page.findOne({ pageId });
    if (!page) {
      res.status(404).json({ error: "Không tìm thấy page" });
      return;
    }

    const { data } = await axios.get<{ data: FacebookPost[] }>(
      `https://graph.facebook.com/v18.0/${pageId}/posts`,
      {
        params: {
          access_token: page.access_token,
          fields: "id,message,created_time,full_picture,attachments{media,subattachments{media}}",
          limit: Number(limit),
          offset: Number(offset),
        },
      }
    );

    // Sử dụng Promise.all để xử lý các thao tác cập nhật bài đăng song song
    await Promise.all(
      data.data.map(async (post) => {
        const fullPostId = `${pageId}_${post.id}`; // Chuẩn hóa ID
        return Post.updateOne(
          { postId: post.id, pageId },
          {
            pageId,
            postId: post.id,
            message: post.message || "",
            created_time: post.created_time,
            full_picture: post.full_picture || "",
            attachments: post.attachments || null,
          },
          { upsert: true }
        );
      })
    );

    // Lấy bài viết từ database và thêm trường hasNewComments
    const posts = await Post.find({ pageId })
      .sort({ created_time: -1 })
      .skip(Number(offset))
      .limit(Number(limit));

    const postsWithNewComments = await Promise.all(
      posts.map(async (post) => {
        const latestComment = await Comment.findOne({ postId: `${pageId}_${post.postId}` })
          .sort({ created_time: -1 })
          .select("direction");
        return {
          ...post.toObject(),
          id: `${pageId}_${post.postId}`, // Chuẩn hóa ID
          hasNewComments: latestComment?.direction === "in" || false,
        };
      })
    );

    res.json(postsWithNewComments);
  } catch (error: any) {
    console.error("❌ Lỗi khi lấy bài đăng từ Facebook:", error.message);
    res.status(500).json({ error: "Không thể lấy bài đăng từ Facebook" });
  }
});

// Lấy comment của post
router.get("/:pageId/:postId/comments", async (req: Request<PostParams>, res: Response): Promise<void> => {
  try {
    const { pageId, postId } = req.params;
    const { limit = 10, offset = 0 } = req.query;

    if (!pageId || !postId) {
      res.status(400).json({ error: "Thiếu pageId hoặc postId" });
      return;
    }

    const page = await Page.findOne({ pageId });
    if (!page) {
      res.status(404).json({ error: "Không tìm thấy page" });
      return;
    }
    const access_token = page.access_token;

    // Lấy tất cả comment và reply trong 1 lần gọi
    const { data } = await axios.get<{ data: FacebookComment[] }>(
      `https://graph.facebook.com/v18.0/${postId}/comments`,
      {
        params: {
          access_token,
          fields: "id,message,from,created_time,parent",
          limit: Number(limit),
          offset: Number(offset),
        },
      }
    );

    // Sử dụng Promise.all để xử lý các thao tác cập nhật bình luận song song
    await Promise.all(
      data.data.map(async (cmt) => {
        // Chỉ lưu comment nếu parent là null hoặc parent thuộc postId này
        if (!cmt.parent || cmt.parent.id === postId) {
          const direction = cmt.from.id === pageId ? "out" : "in"; // Xác định direction
          return Comment.updateOne(
            { commentId: cmt.id },
            {
              postId: `${pageId}_${postId}`, // Chuẩn hóa postId
              commentId: cmt.id,
              message: cmt.message,
              from: cmt.from?.name || "Fanpage",
              created_time: cmt.created_time,
              parent_id: cmt.parent?.id || null,
              direction,
            },
            { upsert: true }
          );
        }
        return Promise.resolve();
      })
    );

    // Trả về tất cả comment của postId
    const comments = await Comment.find({ postId: `${pageId}_${postId}` })
      .sort({ created_time: 1 })
      .skip(Number(offset))
      .limit(Number(limit));

    res.json(comments);
  } catch (error: any) {
    console.error("❌ Lỗi khi lấy bình luận từ Facebook:", error.message);
    res.status(500).json({ error: "Không thể lấy bình luận từ Facebook" });
  }
});

export default router;