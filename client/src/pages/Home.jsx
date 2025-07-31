import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import socket from "../socket";
import { MdOutlineVideoCall } from "react-icons/md";


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
    <div className="flex flex-col items-center justify-center h-screen">
      <button
        onClick={createRoom}
        className="flex flex-row items-center justify-center gap-2 mb-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 cursor-pointer"
      >
        <MdOutlineVideoCall className="size-5"/>
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
          className="ml-2 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 cursor-pointer"
        >
          Join Meeting
        </button>
      </div>
    </div>
  );
}

export default HomePage;
