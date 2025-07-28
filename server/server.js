require("dotenv").config();
const express = require("express");
const { Server } = require("socket.io");
const cors = require("cors");
const mediasoupManager = require("./mediasoupManager");
const socketHandler = require("./socketHandler");

const app = express();

app.use(
  cors({
    origin: `${process.env.PORT}`,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.get('/', (req, res) => {
  res.send("Working..");
})

const server = app.listen(3000, () =>
  console.log("Server running on port 3000")
);

const io = new Server(server, {
  cors: {
    origin: `${process.env.PORT}`,
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

// Catch unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Promise Rejection:", err);
});
