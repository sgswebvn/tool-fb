const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI as string).then(() => {
            console.log("✅ MongoDB connected");
            server.listen(PORT, () => {
                console.log(`🚀 Server running at http://localhost:${PORT}`);
            });
        }).catch((err) => {
            console.error("❌ MongoDB connection error:", err);
            process.exit(1);
        });
    };

    module.exports = connectDB;