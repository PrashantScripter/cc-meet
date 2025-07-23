import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import * as mediasoupClient from "mediasoup-client";
import Controls from "../components/MediaControl";
import VideoGrid from "../components/VideoGrid";
import socket from "../socket";

function MeetingRoom() {
  const { roomId } = useParams();
  const [device, setDevice] = useState(null);
  const [sendTransport, setSendTransport] = useState(null);
  const [recvTransport, setRecvTransport] = useState(null);
  const [producers, setProducers] = useState([]);
  const [consumers, setConsumers] = useState([]);
  const [mySocketId, setMySocketId] = useState(null);
  const localVideoRef = useRef();
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const initializedRef = useRef(false);
  const pendingProducersRef = useRef([]);

  // Track our socket id in state
  useEffect(() => {
    function updateSocketId() {
      setMySocketId(socket.id);
    }
    socket.on("connect", updateSocketId);
    updateSocketId();
    return () => {
      socket.off("connect", updateSocketId);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let localStream;
    initializedRef.current = false;

    // Helper to consume all pending producers
    const consumePendingProducers = (device, transport) => {
      if (pendingProducersRef.current.length > 0) {
        pendingProducersRef.current.forEach(({ producerId, socketId }) => {
          if (socketId === mySocketId) return; // Don't consume own producer
          socket.emit(
            "consume",
            {
              roomId,
              producerId,
              rtpCapabilities: device.rtpCapabilities,
              transportId: transport.id,
            },
            async (consumerParams) => {
              if (consumerParams.error) return;
              try {
                const consumer = await recvTransportRef.current.consume(
                  consumerParams
                );
                setConsumers((prev) => {
                  // Remove any existing consumer with the same producerId and socketId
                  const filtered = prev.filter(
                    (c) =>
                      !(
                        c.producerId === consumerParams.producerId &&
                        c.socketId === socketId
                      )
                  );
                  return [
                    ...filtered,
                    {
                      consumer,
                      producerId: consumerParams.producerId,
                      socketId,
                    },
                  ];
                });
              } catch {}
            }
          );
        });
        pendingProducersRef.current = [];
      }
    };

    // Register event listeners BEFORE joinRoom emit
    const handleNewProducer = ({ producerId, socketId }) => {
      if (socketId === mySocketId) return; // Don't consume own producer
      if (!device || !recvTransportRef.current) {
        pendingProducersRef.current.push({ producerId, socketId });
        if (device && recvTransportRef.current) {
          consumePendingProducers(device, recvTransportRef.current);
        }
        return;
      }
      socket.emit(
        "consume",
        {
          roomId,
          producerId,
          rtpCapabilities: device.rtpCapabilities,
          transportId: recvTransportRef.current.id,
        },
        async (consumerParams) => {
          if (consumerParams.error) return;
          try {
            const consumer = await recvTransportRef.current.consume(
              consumerParams
            );
            setConsumers((prev) => {
              const filtered = prev.filter(
                (c) =>
                  !(
                    c.producerId === consumerParams.producerId &&
                    c.socketId === socketId
                  )
              );
              return [
                ...filtered,
                { consumer, producerId: consumerParams.producerId, socketId },
              ];
            });
          } catch {}
        }
      );
    };

    const handleExistingProducers = (producersList) => {
      if (!device || !recvTransportRef.current) {
        pendingProducersRef.current.push(
          ...producersList.map((p) => ({
            producerId: p.producerId,
            socketId: p.socketId,
          }))
        );
        if (device && recvTransportRef.current) {
          consumePendingProducers(device, recvTransportRef.current);
        }
        return;
      }
      producersList.forEach(({ producerId, socketId }) => {
        if (socketId === mySocketId) return; // Don't consume own producer
        socket.emit(
          "consume",
          {
            roomId,
            producerId,
            rtpCapabilities: device.rtpCapabilities,
            transportId: recvTransportRef.current.id,
          },
          async (consumerParams) => {
            if (consumerParams.error) return;
            try {
              const consumer = await recvTransportRef.current.consume(
                consumerParams
              );
              setConsumers((prev) => {
                const filtered = prev.filter(
                  (c) =>
                    !(
                      c.producerId === consumerParams.producerId &&
                      c.socketId === socketId
                    )
                );
                return [
                  ...filtered,
                  { consumer, producerId: consumerParams.producerId, socketId },
                ];
              });
            } catch {}
          }
        );
      });
    };

    socket.on("newProducer", handleNewProducer);
    socket.on("existingProducers", handleExistingProducers);

    async function init() {
      try {
        // Join room
        socket.emit(
          "joinRoom",
          { roomId },
          async ({ rtpCapabilities, error }) => {
            if (error) {
              alert(error);
              return;
            }
            const device = new mediasoupClient.Device();
            await device.load({ routerRtpCapabilities: rtpCapabilities });
            if (!isMounted) return;
            setDevice(device);

            if (!initializedRef.current) {
              initializedRef.current = true;
              // Create send transport
              socket.emit(
                "createWebRtcTransport",
                { roomId, direction: "send" },
                (params) => {
                  if (params.error) return;
                  const transport = device.createSendTransport(params);
                  transport.on("connect", ({ dtlsParameters }, callback) => {
                    socket.emit(
                      "connectWebRtcTransport",
                      { roomId, transportId: params.id, dtlsParameters },
                      callback
                    );
                  });
                  transport.on(
                    "produce",
                    async ({ kind, rtpParameters }, callback) => {
                      socket.emit(
                        "produce",
                        { roomId, transportId: params.id, kind, rtpParameters },
                        ({ id }) => {
                          callback({ id });
                        }
                      );
                    }
                  );
                  sendTransportRef.current = transport;
                  setSendTransport(transport);
                }
              );
              // Create receive transport
              socket.emit(
                "createWebRtcTransport",
                { roomId, direction: "recv" },
                (params) => {
                  if (params.error) return;
                  const transport = device.createRecvTransport(params);
                  transport.on("connect", ({ dtlsParameters }, callback) => {
                    socket.emit(
                      "connectWebRtcTransport",
                      { roomId, transportId: params.id, dtlsParameters },
                      callback
                    );
                  });
                  recvTransportRef.current = transport;
                  setRecvTransport(transport);
                  consumePendingProducers(device, transport);
                }
              );
            }
          }
        );

        // Cleanup function
        return () => {
          isMounted = false;
          socket.off("newProducer", handleNewProducer);
          socket.off("existingProducers", handleExistingProducers);
          if (sendTransportRef.current) {
            sendTransportRef.current.close();
            sendTransportRef.current = null;
          }
          if (recvTransportRef.current) {
            recvTransportRef.current.close();
            recvTransportRef.current = null;
          }
          setSendTransport(null);
          setRecvTransport(null);
          setProducers([]);
          setConsumers([]);
          if (localStream) {
            localStream.getTracks().forEach((track) => track.stop());
          }
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Initialization error:", err);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, mySocketId]);

  useEffect(() => {
    const handleProducerClosed = ({ producerIds, socketId }) => {
      setConsumers((prev) => prev.filter((c) => c.socketId !== socketId));
    };
    socket.on("producerClosed", handleProducerClosed);
    return () => {
      socket.off("producerClosed", handleProducerClosed);
    };
  }, []);

  // Produce local media after sendTransport is ready
  useEffect(() => {
    let localStream;
    async function produceMedia() {
      if (!sendTransport || !localVideoRef.current) return;
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localVideoRef.current.srcObject = localStream;
        const tracks = localStream.getTracks();
        const newProducers = [];
        for (const track of tracks) {
          try {
            const producer = await sendTransport.produce({ track });
            newProducers.push(producer);
          } catch {}
        }
        setProducers((prev) => [...prev, ...newProducers]);
      } catch {}
    }
    produceMedia();
    return () => {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [sendTransport]);

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
}

export default MeetingRoom;
