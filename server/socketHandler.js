const {
  getRoom,
  addParticipant,
  removeParticipant,
  setTransport,
  getTransport,
  addProducer,
  addConsumer,
  rooms, // Import rooms
  getProducerIds, // Import getProducerIds
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
    // Send all existing producers to the new participant
    const existingProducers = getProducerIds(roomId, socket.id);
    if (existingProducers.length > 0) {
      socket.emit("existingProducers", existingProducers);
      console.log(
        "Emitting existingProducers to",
        socket.id,
        existingProducers
      );
    }
  });

  socket.on(
    "createWebRtcTransport",
    async ({ roomId, direction }, callback) => {
      const room = getRoom(roomId);
      if (!room) return callback({ error: "Room not found" });
      try {
        const transport = await room.router.createWebRtcTransport({
          listenIps: [{ ip: "127.0.0.1" }], // Use 127.0.0.1 for local development
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        });
        // Add ICE and DTLS state logging
        transport.on("icestatechange", (state) => {
          console.log(
            "Transport ICE state:",
            state,
            "for transport:",
            transport.id
          );
        });
        transport.on("dtlsstatechange", (state) => {
          console.log(
            "Transport DTLS state:",
            state,
            "for transport:",
            transport.id
          );
        });
        setTransport(roomId, socket.id, direction, transport); // Store transport
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
      const room = getRoom(roomId);
      if (!room) return callback({ error: "Room not found" });
      const participant = room?.participants.get(socket.id);
      const transport = participant?.recvTransport;
      if (!transport) return callback({ error: "Transport not found" });
      try {
        await transport.connect({ dtlsParameters });
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
      const room = getRoom(roomId);
      if (!room) return callback({ error: "Room not found" });
      const participant = room?.participants.get(socket.id);
      const transport = participant?.recvTransport;
      console.log(
        "Producing with transport:",
        transport?.id,
        "for socket:",
        socket.id
      );
      if (!transport) return callback({ error: "Transport not found" });
      try {
        const producer = await transport.produce({ kind, rtpParameters }); // Line ~58
        addProducer(roomId, socket.id, producer);
        // Debug: log sockets in the room
        const roomSockets = Array.from(socket.adapter.rooms.get(roomId) || []);
        console.log("[DEBUG] Sockets in room", roomId, roomSockets);
        io.in(roomId).emit("newProducer", {
          producerId: producer.id,
          socketId: socket.id,
        });
        console.log(
          "[DEBUG] Emitting newProducer to ALL in room",
          roomId,
          "producerId:",
          producer.id,
          "from socket:",
          socket.id
        );
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
      const participant = room?.participants.get(socket.id);
      const transport = participant?.recvTransport;
      if (!transport) return callback({ error: "Transport not found" });
      try {
        if (room.router.canConsume({ producerId, rtpCapabilities })) {
          const consumer = await transport.consume({
            producerId,
            rtpCapabilities,
          });
          await consumer.resume(); // Ensure the consumer starts receiving media
          addConsumer(roomId, socket.id, consumer);
          callback({
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          });
        } else {
          callback({ error: "Cannot consume" });
        }
      } catch (err) {
        console.error("Error consuming:", err);
        callback({ error: "Failed to consume" });
      }
    }
  );

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    for (const [roomId] of rooms) {
      // Get the list of producer IDs before removing
      const room = getRoom(roomId);
      if (room && room.participants.has(socket.id)) {
        const participant = room.participants.get(socket.id);
        const producerIds = participant.producers.map((p) => p.id);
        // Notify others
        socket
          .to(roomId)
          .emit("producerClosed", { producerIds, socketId: socket.id });
      }
      removeParticipant(roomId, socket.id);
    }
  });
};
