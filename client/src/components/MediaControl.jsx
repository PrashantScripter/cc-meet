import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FaVideo } from "react-icons/fa6";
import { FaVideoSlash } from "react-icons/fa6";
import { FaMicrophone } from "react-icons/fa6";
import { IoMdMicOff } from "react-icons/io";
import { ImPhoneHangUp } from "react-icons/im";

function Controls({ producers }) {
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
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
    <div className="flex justify-center">
      <button
        onClick={toggleAudio}
        className="mx-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 cursor-pointer"
      >
        {audioEnabled ? (
          <FaMicrophone className="size-5" />
        ) : (
          <IoMdMicOff className="size-5 " />
        )}
      </button>
      <button
        onClick={toggleVideo}
        className="mx-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 cursor-pointer"
      >
        {videoEnabled ? (
          <FaVideo className="size-5" />
        ) : (
          <FaVideoSlash className="size-5" />
        )}
      </button>
      <button
        onClick={leaveCall}
        className="mx-2 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 cursor-pointer"
      >
        <ImPhoneHangUp className="size-5" />
      </button>
    </div>
  );
}

export default Controls;

