import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import socket from "../socket";

function HomePage() {
  const [roomId, setRoomId] = useState("");
  const navigate = useNavigate();

  const createRoom = () => {
    socket.emit("createRoom", ({ roomId }) => {
      navigate(`/room/${roomId}`);
    });
  };

  const joinRoom = () => {
    if (roomId) navigate(`/room/${roomId}`);
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
      <button
        onClick={createRoom}
        className="mb-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        New Meeting
      </button>
      <div className="flex">
        <input
          type="text"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Enter Room ID"
          className="px-4 py-2 border rounded"
        />
        <button
          onClick={joinRoom}
          className="ml-2 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Join Meeting
        </button>
      </div>
    </div>
  );
}

export default HomePage;
