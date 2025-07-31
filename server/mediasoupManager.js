const mediasoup = require("mediasoup");

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: {
      minptime: 10,
      useinbandfec: 1,
    },
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
    },
  },
];

async function createWorker() {
  return await mediasoup.createWorker({
    logLevel: "debug",
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });
}

async function createRouter(worker) {
  try {
    const router = await worker.createRouter({ mediaCodecs });
    console.log("Router created with codecs:", mediaCodecs);
    return router;
  } catch (err) {
    console.error("Error creating router:", err);
    throw err;
  }
}

module.exports = { createWorker, createRouter };
