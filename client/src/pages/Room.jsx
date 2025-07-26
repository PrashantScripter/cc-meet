// src/pages/MeetingRoom.jsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import * as mediasoupClient from "mediasoup-client";
import Controls from "../components/MediaControl";
import VideoGrid from "../components/VideoGrid";
import socket from "../socket";

export default React.memo(function MeetingRoom() {
  const { roomId } = useParams();
  const [device, setDevice] = useState(null);
  const [sendTransport, setSendTransport] = useState(null);
  const [recvTransport, setRecvTransport] = useState(null);
  const [producers, setProducers] = useState([]);
  const [consumers, setConsumers] = useState([]);
  const [mySocketId, setMySocketId] = useState(socket.id);

  const localVideoRef = useRef();
  const sendTransportRef = useRef();
  const recvTransportRef = useRef();
  const deviceRef = useRef(null);
  const initializedRef = useRef(false);
  const pendingRef = useRef([]); // Queued producers until we can consume

  // Update socket ID on reconnect
  useEffect(() => {
    const updateId = () => setMySocketId(socket.id);
    socket.on("connect", updateId);
    updateId();
    return () => socket.off("connect", updateId);
  }, []);

  // Consume pending producers
  const consumePending = useCallback(async () => {
    const currentDevice = deviceRef.current || device;
    if (!currentDevice || !recvTransportRef.current) {
      console.log(
        "[consumePending] Skipped: device or recvTransport not ready",
        {
          device: !!currentDevice,
          recvTransport: !!recvTransportRef.current,
        }
      );
      return;
    }

    const seen = new Set();
    const items = pendingRef.current.splice(0).filter(({ producerId }) => {
      if (seen.has(producerId)) return false;
      seen.add(producerId);
      return true;
    });

    if (!items.length) {
      console.log("[consumePending] No pending items to consume");
      return;
    }

    console.log("[consumePending] Consuming items", items);

    for (const { producerId, socketId } of items) {
      if (socketId === mySocketId) continue;

      console.log("[consumePending] Attempting to consume", {
        producerId,
        socketId,
      });
      try {
        socket.emit(
          "consume",
          {
            roomId,
            producerId,
            rtpCapabilities: currentDevice.rtpCapabilities,
            transportId: recvTransportRef.current.id,
          },
          async (params) => {
            if (params.error) {
              console.error("[consumePending] Error consuming", params.error);
              return;
            }
            console.log("[consumePending] Successfully consumed", params);
            const consumer = await recvTransportRef.current.consume(params);
            await consumer.resume();
            if (consumer.track) {
              console.log("[consumePending] Track", {
                kind: consumer.kind,
                readyState: consumer.track.readyState,
              });
            } else {
              console.warn("[consumePending] No track available for consumer");
            }
            setConsumers((prev) => {
              const updated = [
                ...prev.filter((c) => c.producerId !== params.producerId),
                { consumer, producerId: params.producerId, socketId },
              ];
              console.log("[setConsumers] Updated consumers", updated);
              return updated;
            });
          }
        );
      } catch (error) {
        console.error("[consumePending] Exception", error);
      }
    }
  }, [mySocketId, roomId]);

  // Initialize room
  useEffect(() => {
    let mounted = true;

    const handleNew = ({ producerId, socketId }) => {
      console.log("[newProducer] Received", {
        producerId,
        socketId,
        mySocketId,
      });
      if (socketId !== mySocketId) {
        pendingRef.current.push({ producerId, socketId });
        consumePending();
      } else {
        console.log("[newProducer] Ignored own producer");
      }
    };

    const handleExisting = (list) => {
      console.log("[existingProducers] list", list);
      list.forEach((p) => pendingRef.current.push(p));
      consumePending();
    };

    socket.on("newProducer", handleNew);
    socket.on("existingProducers", handleExisting);

    const initializeRoom = async () => {
      try {
        const response = await new Promise((resolve) =>
          socket.emit("joinRoom", { roomId }, (data) => resolve(data))
        );
        if (!mounted || !response || response.error) {
          console.error(
            "[joinRoom] Error:",
            response?.error || "No response from server"
          );
          return;
        }
        console.log("[joinRoom] Success:", response);

        let _device = deviceRef.current || device;
        if (!_device) {
          _device = new mediasoupClient.Device();
          await _device.load({
            routerRtpCapabilities: response.rtpCapabilities,
          });
          if (!mounted) return;
          deviceRef.current = _device;
          setDevice(_device);
          console.log("[initializeRoom] Device initialized", _device);
        }

        if (!initializedRef.current) {
          initializedRef.current = true;

          socket.emit(
            "createWebRtcTransport",
            { roomId, direction: "send" },
            (params) => {
              const transport = _device.createSendTransport(params);
              transport.on("connect", ({ dtlsParameters }, cb) =>
                socket.emit(
                  "connectWebRtcTransport",
                  { roomId, transportId: params.id, dtlsParameters },
                  cb
                )
              );
              transport.on("produce", ({ kind, rtpParameters }, cb) =>
                socket.emit(
                  "produce",
                  { roomId, transportId: params.id, kind, rtpParameters },
                  ({ id }) => cb({ id })
                )
              );
              sendTransportRef.current = transport;
              setSendTransport(transport);
              console.log("[initializeRoom] Send transport created");
            }
          );

          socket.emit(
            "createWebRtcTransport",
            { roomId, direction: "recv" },
            (params) => {
              const transport = _device.createRecvTransport(params);
              transport.on("connect", ({ dtlsParameters }, cb) =>
                socket.emit(
                  "connectWebRtcTransport",
                  { roomId, transportId: params.id, dtlsParameters },
                  cb
                )
              );
              recvTransportRef.current = transport;
              setRecvTransport(transport);
              console.log("[initializeRoom] Recv transport created");
              consumePending();
            }
          );
        }
      } catch (err) {
        console.error("[initializeRoom] Error", err);
      }
    };

    initializeRoom();

    return () => {
      mounted = false;
      socket.off("newProducer", handleNew);
      socket.off("existingProducers", handleExisting);
      if (sendTransportRef.current) sendTransportRef.current.close();
      if (recvTransportRef.current) recvTransportRef.current.close();
      setSendTransport(null);
      setRecvTransport(null);
      setProducers([]);
      setConsumers([]);
      initializedRef.current = false;
    };
  }, [roomId, mySocketId]);

  // Handle recvTransport updates
  useEffect(() => {
    console.log("[useEffect] recvTransport updated", {
      id: recvTransport?.id,
      closed: recvTransport?.closed,
    });
    consumePending();
  }, [recvTransport]);

  // Produce local media
  useEffect(() => {
    let localStream;
    if (!sendTransport) return;

    (async () => {
      if (sendTransport.closed) return;
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
          await localVideoRef.current
            .play()
            .catch((e) => console.error("[localStream] Play error:", e));
        } else {
          console.warn("[localStream] localVideoRef not ready");
        }

        for (const track of localStream.getTracks()) {
          if (sendTransport.closed) break;
          const producer = await sendTransport.produce({ track });
          setProducers((p) => [...p, producer]);
        }
      } catch (error) {
        console.error("[localStream] Error getting media:", error);
      }
    })();

    return () => localStream?.getTracks().forEach((t) => t.stop());
  }, [sendTransport]);

  // Handle producer closed
  useEffect(() => {
    const onClosed = ({ socketId }) => {
      console.log("[producerClosed] removing", socketId);
      setConsumers((c) => c.filter((x) => x.socketId !== socketId));
    };
    socket.on("producerClosed", onClosed);
    return () => socket.off("producerClosed", onClosed);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gray-200">
      <VideoGrid
        consumers={consumers}
        localVideoRef={localVideoRef}
        mySocketId={mySocketId}
      />
      <Controls producers={producers} />
    </div>
  );
});
