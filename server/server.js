require("dotenv").config();
const express = require("express");
const { Server } = require("socket.io");
const cors = require("cors");
const mediasoupManager = require("./mediasoupManager");
const socketHandler = require("./socketHandler");

const app = express();

// Use frontend URL for CORS (set FRONTEND_URL in .env)
app.use(
  cors({
    origin: process.env.FRONTEND_URL, // e.g., https://cc-meet-frontend.vercel.app
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.get("/", (req, res) => {
  res.send("Working..");
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

let worker;
(async () => {
  try {
    worker = await mediasoupManager.createWorker();
    console.log("Mediasoup Worker initialized");

    io.on("connection", (socket) => {
      console.log("Client connected:", socket.id);
      socketHandler(socket, worker, io);
    });
  } catch (err) {
    console.error("Error initializing Mediasoup Worker:", err);
    process.exit(1);
  }
})();

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Promise Rejection:", err);
});
