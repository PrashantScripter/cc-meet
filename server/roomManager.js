const { createRouter } = require("./mediasoupManager");
const { v4: uuidv4 } = require("uuid");

const rooms = new Map();

async function createRoom(worker) {
  const roomId = uuidv4();
  const router = await createRouter(worker);
  rooms.set(roomId, { router, participants: new Map() });
  console.log("Room created:", roomId);
  return roomId;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function addParticipant(roomId, socketId) {
  const room = rooms.get(roomId);
  if (room) {
    if (!room.participants.has(socketId)) {
      room.participants.set(socketId, {
        sendTransport: null,
        recvTransport: null,
        producers: [],
        consumers: [],
      });
      console.log("Participant added:", socketId, "to room:", roomId);
    }
  }
}

function removeParticipant(roomId, socketId) {
  const room = rooms.get(roomId);
  if (room) {
    const participant = room.participants.get(socketId);
    if (participant) {
      if (participant.sendTransport) participant.sendTransport.close();
      if (participant.recvTransport) participant.recvTransport.close();
      participant.producers.forEach((producer) => producer.close());
      participant.consumers.forEach((consumer) => consumer.close());
      room.participants.delete(socketId);
      console.log("Participant removed:", socketId, "from room:", roomId);
      // Remove room if empty
      if (room.participants.size === 0) {
        rooms.delete(roomId);
        console.log("Room deleted:", roomId);
      }
    }
  }
}

function setTransport(roomId, socketId, direction, transport) {
  const room = rooms.get(roomId);
  if (room && room.participants.has(socketId)) {
    const participant = room.participants.get(socketId);
    if (direction === "send") {
      if (participant.sendTransport) {
        participant.sendTransport.close(); // Clean up old transport
      }
      participant.sendTransport = transport;
    } else if (direction === "recv") {
      if (participant.recvTransport) {
        participant.recvTransport.close(); // Clean up old transport
      }
      participant.recvTransport = transport;
    }
    console.log(
      "Transport set:",
      transport.id,
      "for socket:",
      socketId,
      "direction:",
      direction
    );
    console.log("Current participant transports after setTransport:", {
      sendTransport: participant.sendTransport?.id,
      recvTransport: participant.recvTransport?.id,
    });
  }
}

function getTransport(roomId, socketId, transportId) {
  const room = rooms.get(roomId);
  if (!room || !room.participants.has(socketId)) {
    console.log(
      "No room or participant found for room:",
      roomId,
      "socket:",
      socketId
    );
    return null;
  }
  const participant = room.participants.get(socketId);
  console.log("Looking for transportId:", transportId, "in participant:", {
    sendTransport: participant.sendTransport?.id,
    recvTransport: participant.recvTransport?.id,
  });
  const transport =
    participant.sendTransport?.id === transportId
      ? participant.sendTransport
      : participant.recvTransport?.id === transportId
        ? participant.recvTransport
        : null;
  console.log(
    "Transport retrieved:",
    transport?.id,
    "for socket:",
    socketId,
    "transportId:",
    transportId
  );
  return transport;
}

function addProducer(roomId, socketId, producer) {
  const room = rooms.get(roomId);
  if (room && room.participants.has(socketId)) {
    const participant = room.participants.get(socketId);
    participant.producers.push(producer);
    console.log("Producer added:", producer.id, "for socket:", socketId);
  }
}

function addConsumer(roomId, socketId, consumer) {
  const room = rooms.get(roomId);
  if (room && room.participants.has(socketId)) {
    const participant = room.participants.get(socketId);
    participant.consumers.push(consumer);
    console.log("Consumer added:", consumer.id, "for socket:", socketId);
  }
}

function getProducerIds(roomId, excludeSocketId = null) {
  const room = rooms.get(roomId);
  if (!room) return [];
  let producerIds = [];
  for (const [socketId, participant] of room.participants.entries()) {
    if (excludeSocketId && socketId === excludeSocketId) continue;
    for (const producer of participant.producers) {
      producerIds.push({ producerId: producer.id, socketId });
    }
  }
  return producerIds;
}

module.exports = {
  createRoom,
  getRoom,
  addParticipant,
  removeParticipant,
  setTransport,
  getTransport,
  addProducer,
  addConsumer,
  rooms, // Export the rooms Map
  getProducerIds, // Export the new function
};
