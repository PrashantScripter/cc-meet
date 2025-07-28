// mediasoupManager.js
const mediasoup = require("mediasoup");

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: { "x-google-start-bitrate": 1000 },
  },
];

async function createWorker() {
  return await mediasoup.createWorker({
    logLevel: "debug", // Changed from "warn" to "debug" for detailed logs
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });
}

async function createRouter(worker) {
  return await worker.createRouter({ mediaCodecs });
}

module.exports = { createWorker, createRouter };
