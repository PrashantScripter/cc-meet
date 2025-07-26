// socketHandler.js
const {
  getRoom,
  addParticipant,
  removeParticipant,
  setTransport,
  getTransport,
  addProducer,
  addConsumer,
  rooms, // Map of all rooms
  getProducerIds, // helper to list existing producers
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

    // send back RTP capabilities
    callback({ rtpCapabilities: room.router.rtpCapabilities });

    // tell ONLY the newly joined client about all existing producers
    const allProducers = getProducerIds(roomId, socket.id);
    if (allProducers.length) {
      socket.emit("existingProducers", allProducers);
      console.log(
        "Emitting existingProducers to",
        socket.id,
        allProducers
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
          listenIps: [{ ip: "127.0.0.1" }], // local dev
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        });

        // log ICE/DTLS events
        transport.on("icestatechange", (s) =>
          console.log("ICE state", s, "for", transport.id)
        );
        transport.on("dtlsstatechange", (s) =>
          console.log("DTLS state", s, "for", transport.id)
        );

        // store on the correct side (send vs recv)
        setTransport(roomId, socket.id, direction, transport);

        // reply with params the client needs to construct its Transport
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
      // pick the *correct* transport (send or recv) by ID
      const transport = getTransport(roomId, socket.id, transportId);
      if (!transport) {
        console.error("Transport not found for connect:", transportId);
        return callback({ error: "transport not found" });
      }
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
      const transport = getTransport(roomId, socket.id, transportId);
      if (!transport) return callback({ error: "transport not found" });

      try {
        const producer = await transport.produce({ kind, rtpParameters });
        addProducer(roomId, socket.id, producer);

        // Notify ALL peers in the room (including self) about the new producer
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

      // consumers always use recvTransport, but double‐check ID too:
      const transport = getTransport(roomId, socket.id, transportId);
      if (!transport) {
        console.error("Transport not found for consume:", transportId);
        return callback({ error: "transport not found" });
      }

      try {
        if (!room.router.canConsume({ producerId, rtpCapabilities })) {
          return callback({ error: "Cannot consume" });
        }

        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
        });
        await consumer.resume(); // start the flow
        addConsumer(roomId, socket.id, consumer);

        callback({
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } catch (err) {
        console.error("Error consuming:", err);
        callback({ error: "Failed to consume" });
      }
    }
  );

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    // notify everyone else and clean up
    for (const [roomId] of rooms) {
      const room = getRoom(roomId);
      if (!room || !room.participants.has(socket.id)) continue;
      const participant = room.participants.get(socket.id);
      const producerIds = participant.producers.map((p) => p.id);

      socket.to(roomId).emit("producerClosed", {
        socketId: socket.id,
        producerIds,
      });
      removeParticipant(roomId, socket.id);
    }
  });
};
