const {
  getRoom,
  addParticipant,
  removeParticipant,
  setTransport,
  getTransport,
  addProducer,
  addConsumer,
  rooms,
  getProducerIds,
} = require("./roomManager");

module.exports = (socket, worker, io) => {
  console.log("Client connected:", socket.id);

  socket.on("createRoom", async (callback) => {
    try {
      const roomId = await require("./roomManager").createRoom(worker);
      callback({ roomId });
    } catch (err) {
      console.error("Error creating room:", err);
      callback({ error: "Failed to create room" });
    }
  });

  socket.on("joinRoom", ({ roomId }, callback) => {
    const room = getRoom(roomId);
    if (!room) return callback({ error: "Room not found" });

    addParticipant(roomId, socket.id);
    socket.join(roomId);

    callback({ rtpCapabilities: room.router.rtpCapabilities });

    const allProducers = getProducerIds(roomId, socket.id);
    if (allProducers.length) {
      socket.emit("existingProducers", allProducers);
      console.log("Emitting existingProducers to", socket.id, allProducers);
    }
  });

  socket.on(
    "createWebRtcTransport",
    async ({ roomId, direction }, callback) => {
      const room = getRoom(roomId);
      if (!room) return callback({ error: "Room not found" });

      try {
        const transport = await room.router.createWebRtcTransport({
          listenIps: [
            {
              ip: "0.0.0.0",
              announcedIp:
                process.env.PUBLIC_IP || "cc-meet.onrender.com", // Replace with your Render domain
            },
          ],
          enableUdp: false, // Disable UDP since Render blocks it
          enableTcp: true, // Enable TCP
          preferTcp: true, // Prioritize TCP
          initialAvailableOutgoingBitrate: 1000000,
        });

        transport.on("icestatechange", (s) =>
          console.log("ICE state", s, "for", transport.id)
        );
        transport.on("dtlsstatechange", (s) =>
          console.log("DTLS state", s, "for", transport.id)
        );
        transport.on("close", () =>
          console.log("Transport closed:", transport.id)
        );

        setTransport(roomId, socket.id, direction, transport);
        console.log(
          "Transport set:",
          transport.id,
          "for socket:",
          socket.id,
          "direction:",
          direction
        );

        callback({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
      } catch (err) {
        console.error("Error creating transport:", err);
        callback({ error: "Failed to create transport" });
      }
    }
  );

  socket.on(
    "connectWebRtcTransport",
    async ({ roomId, transportId, dtlsParameters }, callback) => {
      const transport = getTransport(roomId, socket.id, transportId);
      if (!transport) {
        console.error("Transport not found for connect:", transportId);
        return callback({ error: "transport not found" });
      }
      try {
        await transport.connect({ dtlsParameters });
        console.log("Transport connected:", transportId);
        callback({});
      } catch (err) {
        console.error("Error connecting transport:", err);
        callback({ error: "Failed to connect transport" });
      }
    }
  );

  socket.on(
    "produce",
    async ({ roomId, transportId, kind, rtpParameters }, callback) => {
      const transport = getTransport(roomId, socket.id, transportId);
      if (!transport) return callback({ error: "transport not found" });

      try {
        const producer = await transport.produce({ kind, rtpParameters });
        producer.on("close", () => {
          console.log("Producer closed:", producer.id);
          io.to(roomId).emit("producerClosed", {
            socketId: socket.id,
            producerIds: [producer.id],
          });
        });
        addProducer(roomId, socket.id, producer);

        console.log("Producer created:", {
          id: producer.id,
          kind: producer.kind,
          rtpParameters,
          closed: producer.closed,
          track: producer.track,
        });

        setInterval(async () => {
          try {
            const stats = await producer.getStats();
            const statsMap =
              stats instanceof Map ? stats : new Map(Object.entries(stats));
            const outboundRtp =
              statsMap.get("outbound-rtp")?.values().next().value ||
              (Array.isArray(stats)
                ? stats.find((s) => s.type === "outbound-rtp")
                : {});
            console.log("Producer stats:", {
              id: producer.id,
              kind: producer.kind,
              packetsSent:
                outboundRtp?.packetsSent || outboundRtp?.packetCount || 0,
              stats,
            });
          } catch (err) {
            console.error("Error getting producer stats:", err);
          }
        }, 60 * 1000);

        io.to(roomId).emit("newProducer", {
          producerId: producer.id,
          socketId: socket.id,
        });

        console.log("Emitted newProducer", producer.id, "in room", roomId);
        callback({ id: producer.id });
      } catch (err) {
        console.error("Error producing:", err);
        callback({ error: "Failed to produce" });
      }
    }
  );

  socket.on(
    "consume",
    async ({ roomId, transportId, producerId, rtpCapabilities }, callback) => {
      const room = getRoom(roomId);
      if (!room) return callback({ error: "Room not found" });

      const transport = getTransport(roomId, socket.id, transportId);
      if (!transport) {
        console.error("Transport not found for consume:", transportId);
        return callback({ error: "transport not found" });
      }

      try {
        let targetProducer = null;
        for (const [, participant] of room.participants) {
          targetProducer = participant.producers.find(
            (p) => p.id === producerId
          );
          if (targetProducer) break;
        }

        if (!targetProducer) {
          console.error("Producer not found:", producerId);
          return callback({ error: "Producer not found" });
        }

        if (targetProducer.closed) {
          console.error("Producer is closed:", producerId);
          return callback({ error: "Producer is closed" });
        }

        console.log("Producer state before consume:", {
          id: targetProducer.id,
          kind: targetProducer.kind,
          closed: targetProducer.closed,
          paused: targetProducer.paused,
        });

        if (!room.router.canConsume({ producerId, rtpCapabilities })) {
          console.error("Cannot consume producer:", producerId);
          return callback({
            error: "Cannot consume - RTP capabilities mismatch",
          });
        }

        console.log("Creating consumer for producer:", producerId);

        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          paused: false,
        });

        console.log("Consumer created successfully:", {
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          closed: consumer.closed,
          paused: consumer.paused,
          rtpParameters: consumer.rtpParameters,
        });

        consumer.on("close", () => {
          console.log("Consumer closed:", consumer.id);
        });

        consumer.on("pause", () => {
          console.log("Consumer paused:", consumer.id);
        });

        consumer.on("resume", () => {
          console.log("Consumer resumed:", consumer.id);
        });

        if (consumer.paused) {
          await consumer.resume();
          console.log("Consumer resumed:", consumer.id);
        }

        setInterval(async () => {
          try {
            const stats = await consumer.getStats();
            console.log("Consumer stats:", {
              id: consumer.id,
              kind: consumer.kind,
              stats: Array.isArray(stats) ? stats : Object.values(stats),
            });
          } catch (err) {
            console.error("Error getting consumer stats:", err);
          }
        }, 30 * 1000);

        addConsumer(roomId, socket.id, consumer);

        callback({
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } catch (err) {
        console.error("Error consuming:", err);
        callback({ error: `Failed to consume: ${err.message}` });
      }
    }
  );

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    for (const [roomId] of rooms) {
      const room = getRoom(roomId);
      if (!room || !room.participants.has(socket.id)) continue;
      const participant = room.participants.get(socket.id);
      const producerIds = participant.producers.map((p) => p.id);
      participant.producers.forEach((p) => {
        p.close();
        console.log("Producer closed on disconnect:", p.id);
      });

      socket.to(roomId).emit("producerClosed", {
        socketId: socket.id,
        producerIds,
      });
      removeParticipant(roomId, socket.id);
    }
  });
};
