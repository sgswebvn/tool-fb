import "dotenv/config";
import http from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import app from "./app";
import messageRoutes from "./routes/messages";
import Package from "./models/Package";


const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.set("io", io);
app.use("/messages", messageRoutes(io));

const PORT = process.env.PORT || 3001;

mongoose.connect(process.env.MONGO_URI as string).then(() => {
    console.log("✅ MongoDB connected");
    server.listen(PORT, () => {
        console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
});


async function seedPackages() {
    await Package.create([
        { name: "free", maxPages: 1, price: 0 },
        { name: "basic", maxPages: 10, price: 99000 },
        { name: "pro", maxPages: 50, price: 299000 },
        { name: "custom", maxPages: 100, price: 0, customizable: true },
    ]);
    console.log("Seeded packages!");
}

seedPackages();