// src/components/VideoGrid.jsx
import React, { useEffect, useRef, useState, memo } from "react";

export default function VideoGrid({ consumers, localVideoRef, mySocketId }) {
  const consumerMap = new Map();
  consumers.forEach(({ consumer, producerId, socketId }) => {
    if (socketId !== mySocketId) {
      if (!consumerMap.has(socketId)) {
        consumerMap.set(socketId, { audio: null, video: null });
      }
      const entry = consumerMap.get(socketId);
      if (consumer.kind === "audio") {
        entry.audio = consumer;
        console.log(
          `[VideoGrid] Added audio consumer for socketId: ${socketId}, producerId: ${producerId}, track:`,
          consumer.track
        );
      }
      if (consumer.kind === "video") {
        entry.video = consumer;
        console.log(
          `[VideoGrid] Added video consumer for socketId: ${socketId}, producerId: ${producerId}, track:`,
          consumer.track
        );
      }
    }
  });

  const uniqueConsumers = Array.from(consumerMap.values()).filter(
    (entry) => entry.video
  );

  console.log("[VideoGrid] Unique consumers:", uniqueConsumers);
  console.log("[VideoGrid] Raw consumers:", consumers);

  const [mediaEnabled, setMediaEnabled] = useState(false);

  const handleStartMedia = () => {
    setMediaEnabled(true);
  };

  return (
    <div className="flex flex-col items-center w-full h-full gap-4 p-4">
      {!mediaEnabled && (
        <button
          onClick={handleStartMedia}
          className="bg-green-500 text-white px-4 py-2 rounded mb-4"
        >
          Start Media (Click to Enable Audio/Video)
        </button>
      )}
      <div className="flex flex-wrap justify-center items-start w-full h-full gap-4">
        <video
          ref={localVideoRef}
          autoPlay
          muted={!mediaEnabled}
          playsInline
          className="rounded-lg border shadow w-64 h-48 object-cover bg-black"
        />
        {uniqueConsumers.map((entry, index) =>
          mediaEnabled ? (
            <RemotePeer
              key={index}
              audioConsumer={entry.audio}
              videoConsumer={entry.video}
            />
          ) : null
        )}
      </div>
    </div>
  );
}

const RemotePeer = memo(({ audioConsumer, videoConsumer }) => {
  const videoRef = useRef();
  const audioRef = useRef();
  const [isPlaying, setIsPlaying] = useState(false);

  const handleManualPlay = () => {
    if (audioRef.current) {
      audioRef.current.volume = 1;
      audioRef.current
        .play()
        .then(() => {
          console.log("[RemotePeer] Manual play succeeded");
          setIsPlaying(true);
        })
        .catch((e) =>
          console.error(`Manual audio play error: ${e.message}`, {
            error: e,
            state: audioRef.current.readyState,
          })
        );
    }
  };

  useEffect(() => {
    if (videoRef.current && videoConsumer) {
      if (videoConsumer.track) {
        const stream = new MediaStream();
        stream.addTrack(videoConsumer.track);
        videoRef.current.srcObject = stream;
        videoRef.current
          .play()
          .catch((e) => console.error(`Video play error: ${e.message}`));
        console.log(
          "[RemotePeer] Attached video track, readyState:",
          videoConsumer.track.readyState
        );
      } else {
        console.log("[RemotePeer] Video track not available for videoConsumer");
      }
    }

    const attachAudio = () => {
      if (audioRef.current && audioConsumer) {
        if (audioConsumer.track) {
          const stream = new MediaStream();
          stream.addTrack(audioConsumer.track);
          audioRef.current.srcObject = stream;
          audioRef.current.volume = 1;

          const tryPlay = () => {
            audioRef.current
              .play()
              .then(() => {
                console.log("[RemotePeer] Auto play succeeded");
                setIsPlaying(true);
              })
              .catch((e) => {
                console.error(`Audio play error: ${e.message}`, {
                  error: e,
                  track: audioConsumer.track,
                  readyState: audioConsumer.track.readyState,
                });
                if (e.name === "NotAllowedError" && !isPlaying) {
                  setTimeout(tryPlay, 500); // Retry if blocked by autoplay
                }
              });
          };
          tryPlay();

          console.log(
            "[RemotePeer] Attached audio track, readyState:",
            audioConsumer.track.readyState,
            "muted:",
            audioRef.current.muted,
            "volume:",
            audioRef.current.volume,
            "paused:",
            audioRef.current.paused,
            "currentTime:",
            audioRef.current.currentTime
          );

          // Monitor currentTime to detect playback
          const interval = setInterval(() => {
            if (audioRef.current && audioRef.current.currentTime > 0) {
              console.log(
                "[RemotePeer] Audio playing, currentTime:",
                audioRef.current.currentTime
              );
              clearInterval(interval);
            }
          }, 1000);
          return () => clearInterval(interval);
        } else {
          console.log("[RemotePeer] Audio track not available, retrying...");
          setTimeout(attachAudio, 500);
        }
      }
    };
    attachAudio();
  }, [videoConsumer, audioConsumer]);

  return (
    <div className="relative">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="rounded-lg border shadow w-64 h-48 object-cover bg-black"
      />
      <audio ref={audioRef} autoPlay playsInline style={{ display: "none" }} />
      <button
        onClick={handleManualPlay}
        style={{
          position: "absolute",
          bottom: "10px",
          left: "10px",
          zIndex: 10,
        }}
        className="bg-blue-500 text-white px-2 py-1 rounded"
        disabled={isPlaying}
      >
        {isPlaying ? "Playing" : "Play Audio"}
      </button>
    </div>
  );
});
