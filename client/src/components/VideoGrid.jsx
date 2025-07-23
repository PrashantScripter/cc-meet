import React, { useEffect, useRef } from "react";

function VideoGrid({ consumers, localVideoRef, mySocketId }) {
  // Only show remote video consumers, not own video, and only unique producerId+socketId
  const uniqueConsumers = [];
  const seen = new Set();
  consumers.forEach((c) => {
    if (
      c.consumer &&
      c.consumer.track &&
      c.consumer.kind === "video" &&
      c.socketId !== mySocketId
    ) {
      const key = `${c.producerId}:${c.socketId}`;
      if (!seen.has(key)) {
        uniqueConsumers.push(c);
        seen.add(key);
      }
    }
  });

  return (
    <div className="flex flex-row justify-center items-center w-full h-full gap-4 p-4">
      {/* Local video */}
      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        className="rounded-lg border shadow w-80 h-60 object-cover bg-black"
      />
      {/* Remote videos */}
      {uniqueConsumers.map((c) => (
        <RemoteVideo key={c.consumer.id} consumer={c.consumer} />
      ))}
    </div>
  );
}

function RemoteVideo({ consumer }) {
  const videoRef = useRef();

  useEffect(() => {
    if (videoRef.current && consumer.track) {
      videoRef.current.srcObject = new MediaStream([consumer.track]);
    }
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [consumer]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      className="rounded-lg border shadow w-80 h-60 object-cover bg-black"
    />
  );
}

export default VideoGrid;
