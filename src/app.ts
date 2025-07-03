import express from "express";
import cors from "cors";
import helmet from "helmet";
import bodyParser from "body-parser";
import authRoutes from "./routes/auth";
import pageRoutes from "./routes/pages";
import postRoutes from "./routes/posts";
import commentRoutes from "./routes/comments";
import webhookRoutes from "./routes/webhook";
import packagesRoutes from "./routes/packages";
import usersRoutes from "./routes/users";


const app = express();
app.use(helmet());
app.use(cors({ origin: ["http://localhost:3000"], credentials: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/auth", authRoutes);
app.use("/pages", pageRoutes);
app.use("/posts", postRoutes);
app.use("/comments", commentRoutes);
app.use("/webhook", webhookRoutes);
app.use("/packages", packagesRoutes);
app.use("/users", usersRoutes);

export default app;