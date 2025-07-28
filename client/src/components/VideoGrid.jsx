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
      if (consumer.kind === "audio" && !entry.audio) {
        entry.audio = consumer;
        console.log(
          `[VideoGrid] Added audio consumer for socketId: ${socketId}, producerId: ${producerId}, track:`,
          consumer.track
        );
      }
      if (consumer.kind === "video" && !entry.video) {
        entry.video = consumer;
        console.log(
          `[VideoGrid] Added video consumer for socketId: ${socketId}, producerId: ${producerId}, track:`,
          consumer.track
        );
      }
    }
  });

  const uniqueConsumers = Array.from(consumerMap.values()).filter(
    (entry) => entry.video || entry.audio
  );

  console.log("[VideoGrid] Unique consumers:", uniqueConsumers);
  console.log("[VideoGrid] Raw consumers:", consumers);

  return (
    <div className="flex flex-col items-center w-full h-full gap-4 p-4">
      <div className="flex flex-wrap justify-center items-start w-full h-full gap-4">
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className="rounded-lg border shadow w-64 h-48 object-cover bg-black"
        />
        {uniqueConsumers.map((entry, index) => (
          <RemotePeer
            key={index}
            audioConsumer={entry.audio}
            videoConsumer={entry.video}
          />
        ))}
      </div>
    </div>
  );
}

const RemotePeer = memo(({ audioConsumer, videoConsumer }) => {
  const videoRef = useRef();
  const audioRef = useRef();
  const [isPlaying, setIsPlaying] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);

  const handleManualPlay = () => {
    setUserInteracted(true);
    if (audioRef.current) {
      audioRef.current.volume = 1;
      audioRef.current.muted = false;
      audioRef.current
        .play()
        .then(() => {
          console.log("[RemotePeer] Manual play succeeded");
          setIsPlaying(true);
        })
        .catch((e) =>
          console.error(`[RemotePeer] Manual audio play error: ${e.message}`, {
            error: e,
            readyState: audioRef.current.readyState,
            muted: audioRef.current.muted,
            volume: audioRef.current.volume,
            trackEnabled: audioConsumer?.track?.enabled,
          })
        );
    }
  };

  useEffect(() => {
    if (videoRef.current && videoConsumer && videoConsumer.track) {
      const stream = new MediaStream();
      stream.addTrack(videoConsumer.track);
      videoRef.current.srcObject = stream;
      videoRef.current
        .play()
        .catch((e) =>
          console.error(`[RemotePeer] Video play error: ${e.message}`)
        );
      console.log(
        "[RemotePeer] Attached video track, readyState:",
        videoConsumer.track.readyState,
        "enabled:",
        videoConsumer.track.enabled
      );
    } else if (videoConsumer && !videoConsumer.track) {
      console.log("[RemotePeer] Video track not available for videoConsumer");
    }

    if (audioRef.current && audioConsumer && audioConsumer.track) {
      const stream = new MediaStream();
      stream.addTrack(audioConsumer.track);
      audioRef.current.srcObject = stream;
      audioRef.current.volume = 1;
      audioRef.current.muted = false;

      const tryPlay = () => {
        if (!userInteracted) {
          console.log(
            "[RemotePeer] Waiting for user interaction to play audio"
          );
          return;
        }
        if (!audioConsumer.track.enabled) {
          console.log("[RemotePeer] Audio track disabled, skipping play");
          return;
        }
        audioRef.current
          .play()
          .then(() => {
            console.log("[RemotePeer] Auto play succeeded");
            setIsPlaying(true);
          })
          .catch((e) => {
            console.error(`[RemotePeer] Audio play error: ${e.message}`, {
              error: e,
              readyState: audioRef.current.readyState,
              muted: audioRef.current.muted,
              volume: audioRef.current.volume,
              trackEnabled: audioConsumer.track.enabled,
            });
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
        audioRef.current.currentTime,
        "trackEnabled:",
        audioConsumer.track.enabled
      );

      // Monitor playback progress
      const interval = setInterval(() => {
        if (audioRef.current) {
          console.log(
            "[RemotePeer] Audio playback status, currentTime:",
            audioRef.current.currentTime,
            "paused:",
            audioRef.current.paused,
            "readyState:",
            audioConsumer.track.readyState,
            "deliveredFrames:",
            audioConsumer.track.stats?.deliveredFrames || "N/A",
            "trackEnabled:",
            audioConsumer.track.enabled
          );
          if (audioRef.current.currentTime > 0) {
            console.log(
              "[RemotePeer] Audio playing, currentTime:",
              audioRef.current.currentTime
            );
            clearInterval(interval);
          }
        }
      }, 1000);
      return () => clearInterval(interval);
    } else if (audioConsumer && !audioConsumer.track) {
      console.log("[RemotePeer] Audio track not available for audioConsumer");
    }
  }, [videoConsumer, audioConsumer, userInteracted]);

  // Detect user interaction
  useEffect(() => {
    const handleInteraction = () => {
      if (!userInteracted) {
        setUserInteracted(true);
        console.log(
          "[RemotePeer] User interaction detected, enabling audio playback"
        );
        if (
          audioRef.current &&
          audioRef.current.srcObject &&
          !isPlaying &&
          audioConsumer?.track?.enabled
        ) {
          audioRef.current
            .play()
            .then(() => {
              console.log("[RemotePeer] Auto play succeeded after interaction");
              setIsPlaying(true);
            })
            .catch((e) =>
              console.error(
                `[RemotePeer] Audio play error after interaction: ${e.message}`,
                {
                  error: e,
                  readyState: audioRef.current.readyState,
                  muted: audioRef.current.muted,
                  volume: audioRef.current.volume,
                  trackEnabled: audioConsumer?.track?.enabled,
                }
              )
            );
        }
      }
    };
    document.addEventListener("click", handleInteraction);
    return () => document.removeEventListener("click", handleInteraction);
  }, [userInteracted, isPlaying, audioConsumer]);

  return (
    <div className="relative">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="rounded-lg border shadow w-64 h-48 object-cover bg-black"
      />
      <audio ref={audioRef} autoPlay playsInline />
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
