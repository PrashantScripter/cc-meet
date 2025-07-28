import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

function Controls({ producers }) {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    return () => {
      producers.forEach((producer) => producer.close());
    };
  }, [producers]);

  const toggleAudio = () => {
    producers.forEach((producer) => {
      if (producer.kind === "audio") {
        producer.track.enabled = !audioEnabled;
        console.log("[toggleAudio] Audio track enabled:", producer.track.enabled);
      }
    });
    setAudioEnabled(!audioEnabled);
  };

  const toggleVideo = () => {
    producers.forEach((producer) => {
      if (producer.kind === "video") {
        producer.track.enabled = !videoEnabled;
        console.log("[toggleVideo] Video track enabled:", producer.track.enabled);
      }
    });
    setVideoEnabled(!videoEnabled);
  };

  const leaveCall = () => {
    producers.forEach((producer) => producer.close());
    navigate("/");
  };

  return (
    <div className="flex justify-center p-4 bg-gray-800">
      <button
        onClick={toggleAudio}
        className="mx-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        {audioEnabled ? "Mute" : "Unmute"}
      </button>
      <button
        onClick={toggleVideo}
        className="mx-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        {videoEnabled ? "Turn Off Camera" : "Turn On Camera"}
      </button>
      <button
        onClick={leaveCall}
        className="mx-2 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
      >
        Leave Call
      </button>
    </div>
  );
}

export default Controls;

