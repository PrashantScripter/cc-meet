import React, { useEffect, useRef, useState, memo } from "react";

export default function VideoGrid({
  consumers,
  localVideoRef,
  mySocketId,
  audioContext,
}) {
  const [gridDimensions, setGridDimensions] = useState({
    columns: 1,
    tileWidth: 0,
    tileHeight: 0,
  });
  const containerRef = useRef(null);

  // Build consumer map
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

  // Calculate grid layout dynamically
  useEffect(() => {
    const updateGridLayout = () => {
      if (!containerRef.current) return;

      const containerWidth = containerRef.current.offsetWidth;
      const containerHeight = containerRef.current.offsetHeight;
      const participantCount = uniqueConsumers.length + 1; // Include local video
      const aspectRatio = 16 / 9; // Standard video aspect ratio

      // Calculate optimal number of columns
      const columns = Math.ceil(Math.sqrt(participantCount));
      const rows = Math.ceil(participantCount / columns);

      // Calculate tile dimensions while maintaining aspect ratio
      const tileWidth = Math.min(
        containerWidth / columns,
        (containerHeight / rows) * aspectRatio
      );
      const tileHeight = tileWidth / aspectRatio;

      setGridDimensions({ columns, tileWidth, tileHeight });
    };

    updateGridLayout();
    window.addEventListener("resize", updateGridLayout);

    return () => window.removeEventListener("resize", updateGridLayout);
  }, [uniqueConsumers.length]);

  console.log("[VideoGrid] Unique consumers:", uniqueConsumers);
  console.log("[VideoGrid] Raw consumers:", consumers);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-blue-100 rounded-2xl p-4 overflow-hidden"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${gridDimensions.columns}, minmax(0, ${gridDimensions.tileWidth}px))`,
        gap: "8px",
        justifyContent: "center",
        alignContent: "center",
      }}
    >
      <div className="relative">
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className="rounded-2xl border-2 border-black shadow w-full h-full object-cover bg-black"
          style={{
            aspectRatio: "16/9",
            maxWidth: `${gridDimensions.tileWidth}px`,
            maxHeight: `${gridDimensions.tileHeight}px`,
          }}
        />
        <div className="absolute top-2 right-2 bg-gray-800 text-white px-2 py-1 rounded text-xs">
          You
        </div>
      </div>
      {uniqueConsumers.map((entry, index) => (
        <RemotePeer
          key={index}
          audioConsumer={entry.audio}
          videoConsumer={entry.video}
          audioContext={audioContext}
          tileWidth={gridDimensions.tileWidth}
          tileHeight={gridDimensions.tileHeight}
        />
      ))}
    </div>
  );
}

const RemotePeer = memo(
  ({ audioConsumer, videoConsumer, audioContext, tileWidth, tileHeight }) => {
    const videoRef = useRef();
    const audioRef = useRef();
    const [isAudioPlaying, setIsAudioPlaying] = useState(false);
    const [userInteracted, setUserInteracted] = useState(false);

    // Setup audio stream
    useEffect(() => {
      if (audioConsumer && audioConsumer.track && audioRef.current) {
        const audioStream = new MediaStream([audioConsumer.track]);
        audioRef.current.srcObject = audioStream;
        audioRef.current.volume = 1.0;

        console.log("[RemotePeer] Audio stream setup:", {
          track: audioConsumer.track,
          readyState: audioConsumer.track.readyState,
          enabled: audioConsumer.track.enabled,
          muted: audioConsumer.track.muted,
        });

        audioRef.current
          .play()
          .then(() => {
            setIsAudioPlaying(true);
            console.log("[RemotePeer] Audio playing automatically");
          })
          .catch((e) => {
            console.log(
              "[RemotePeer] Audio autoplay blocked, waiting for user interaction:",
              e.message
            );
          });
      }
    }, [audioConsumer]);

    // Setup video stream
    useEffect(() => {
      if (videoRef.current && videoConsumer && videoConsumer.track) {
        const videoStream = new MediaStream([videoConsumer.track]);
        videoRef.current.srcObject = videoStream;
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
      }
    }, [videoConsumer]);

    // Handle manual audio play
    const handleManualAudioPlay = async () => {
      if (audioRef.current) {
        try {
          await audioRef.current.play();
          setIsAudioPlaying(true);
          setUserInteracted(true);
          console.log("[RemotePeer] Audio started manually");
        } catch (e) {
          console.error("[RemotePeer] Manual audio play error:", e);
        }
      }
    };

    // Detect user interaction for autoplay policy
    useEffect(() => {
      const handleInteraction = async () => {
        if (!userInteracted && audioRef.current && !isAudioPlaying) {
          try {
            await audioRef.current.play();
            setIsAudioPlaying(true);
            setUserInteracted(true);
            console.log("[RemotePeer] Audio started after user interaction");
          } catch (e) {
            console.log(
              "[RemotePeer] Audio play failed after interaction:",
              e.message
            );
          }
        }
      };

      document.addEventListener("click", handleInteraction, { once: true });
      document.addEventListener("touchstart", handleInteraction, {
        once: true,
      });

      return () => {
        document.removeEventListener("click", handleInteraction);
        document.removeEventListener("touchstart", handleInteraction);
      };
    }, [userInteracted, isAudioPlaying]);

    return (
      <div className="relative group">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="rounded-2xl border-2 shadow w-full h-full object-cover bg-black"
          style={{
            aspectRatio: "16/9",
            maxWidth: `${tileWidth}px`,
            maxHeight: `${tileHeight}px`,
          }}
        />
        <audio ref={audioRef} autoPlay style={{ display: "none" }} />
        {audioConsumer && (
          <div className="absolute top-2 right-2 bg-gray-800 text-white px-2 py-1 rounded text-xs">
            {isAudioPlaying ? "🔊" : "🔇"}
          </div>
        )}
      </div>
    );
  }
);
