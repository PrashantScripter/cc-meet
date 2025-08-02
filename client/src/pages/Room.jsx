import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import * as mediasoupClient from "mediasoup-client";
import Controls from "../components/MediaControl";
import VideoGrid from "../components/VideoGrid";
import socket from "../socket.js";

export default React.memo(function MeetingRoom() {
  const [device, setDevice] = useState(null);
  const [audioContext, setAudioContext] = useState(null);

  useEffect(() => {
    if (device && !audioContext) {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      setAudioContext(ac);
    }
  }, [device]);

  const { roomId } = useParams();
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
  const pendingRef = useRef([]);

  // ICE servers configuration with your ExpressTurn TURN server
  const iceServers = [
    // STUN servers for initial connectivity
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },

    // Your ExpressTurn TURN server with TCP (primary for Render)
    {
      urls: "turn:relay1.expressturn.com:3478?transport=tcp",
      username: "000000002069484607",
      credential: "GDumVjUHM1A53mLt9NWhnnaah/s=",
    },

    // Your ExpressTurn TURN server with UDP (fallback)
    {
      urls: "turn:relay1.expressturn.com:3478?transport=udp",
      username: "000000002069484607",
      credential: "GDumVjUHM1A53mLt9NWhnnaah/s=",
    },

    // Alternative port for better connectivity
    {
      urls: "turn:relay1.expressturn.com:3480?transport=tcp",
      username: "000000002069484607",
      credential: "GDumVjUHM1A53mLt9NWhnnaah/s=",
    },
  ];

  useEffect(() => {
    const updateId = () => setMySocketId(socket.id);
    socket.on("connect", updateId);
    updateId();
    return () => socket.off("connect", updateId);
  }, []);

  const consumePending = useCallback(async () => {
    const currentDevice = deviceRef.current || device;
    if (!currentDevice || !recvTransportRef.current) {
      console.log(
        "[consumePending] Skipped: device or recvTransport not ready",
        { device: !!currentDevice, recvTransport: !!recvTransportRef.current }
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
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Consume timeout")),
            10000
          );

          socket.emit(
            "consume",
            {
              roomId,
              producerId,
              rtpCapabilities: currentDevice.rtpCapabilities,
              transportId: recvTransportRef.current.id,
            },
            async (params) => {
              clearTimeout(timeout);

              if (params.error) {
                console.error("[consumePending] Error consuming", params.error);
                reject(new Error(params.error));
                return;
              }

              console.log(
                "[consumePending] Successfully got consume params",
                params
              );

              try {
                await new Promise((r) => setTimeout(r, 100));

                const consumer = await recvTransportRef.current.consume(params);
                console.log("[consumePending] Consumer created:", {
                  id: consumer.id,
                  kind: consumer.kind,
                  producerId: consumer.producerId,
                  track: consumer.track
                    ? {
                        id: consumer.track.id,
                        kind: consumer.track.kind,
                        readyState: consumer.track.readyState,
                        enabled: consumer.track.enabled,
                        muted: consumer.track.muted,
                      }
                    : null,
                });

                await consumer.resume();
                console.log("[consumePending] Consumer resumed");

                await new Promise((r) => setTimeout(r, 200));

                if (consumer.track) {
                  console.log("[consumePending] Final track state:", {
                    kind: consumer.kind,
                    readyState: consumer.track.readyState,
                    enabled: consumer.track.enabled,
                    muted: consumer.track.muted,
                  });
                } else {
                  console.warn(
                    "[consumePending] No track available for consumer"
                  );
                }

                setConsumers((prev) => {
                  const filtered = prev.filter(
                    (c) => c.producerId !== params.producerId
                  );
                  const updated = [
                    ...filtered,
                    { consumer, producerId: params.producerId, socketId },
                  ];
                  console.log(
                    "[setConsumers] Updated consumers",
                    updated.length
                  );
                  return updated;
                });

                resolve();
              } catch (consumeError) {
                console.error(
                  "[consumePending] Consumer creation error:",
                  consumeError
                );
                reject(consumeError);
              }
            }
          );
        });
      } catch (error) {
        console.error(
          "[consumePending] Exception for producer",
          producerId,
          error
        );
      }
    }
  }, [device, mySocketId, roomId]);

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
        setTimeout(() => consumePending(), 500);
      } else {
        console.log("[newProducer] Ignored own producer");
      }
    };

    const handleExisting = (list) => {
      console.log("[existingProducers] list", list);
      list.forEach((p) => pendingRef.current.push(p));
      setTimeout(() => consumePending(), 1000);
    };

    socket.on("newProducer", handleNew);
    socket.on("existingProducers", handleExisting);

    const initializeRoom = async () => {
      try {
        const response = await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("joinRoom timeout")),
            10000
          );
          socket.emit("joinRoom", { roomId }, (data) => {
            clearTimeout(timeout);
            resolve(data);
          });
        });

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

          // Create send transport with TURN server configuration
          socket.emit(
            "createWebRtcTransport",
            { roomId, direction: "send" },
            (params) => {
              if (params.error) {
                console.error(
                  "[initializeRoom] Send transport error:",
                  params.error
                );
                return;
              }

              console.log(
                "[initializeRoom] Creating send transport with TURN servers"
              );

              const transport = _device.createSendTransport({
                ...params,
                iceServers,
                iceTransportPolicy: "all", // Allow both UDP and TCP
                iceCandidatePoolSize: 10, // Increase candidate pool for better connectivity
                bundlePolicy: "balanced",
                rtcpMuxPolicy: "require",
              });

              // Enhanced connection event logging
              transport.on("connect", ({ dtlsParameters }, cb) => {
                console.log("[sendTransport] Connecting...");
                socket.emit(
                  "connectWebRtcTransport",
                  { roomId, transportId: params.id, dtlsParameters },
                  (result) => {
                    console.log("[sendTransport] Connect result:", result);
                    cb(result);
                  }
                );
              });

              transport.on("produce", ({ kind, rtpParameters }, cb) => {
                console.log(`[sendTransport] Producing ${kind}`);
                socket.emit(
                  "produce",
                  { roomId, transportId: params.id, kind, rtpParameters },
                  ({ id, error }) => {
                    if (error) {
                      console.error(
                        `[sendTransport] Produce error for ${kind}:`,
                        error
                      );
                    } else {
                      console.log(
                        `[sendTransport] Produced ${kind} with id:`,
                        id
                      );
                    }
                    cb({ id });
                  }
                );
              });

              // Additional transport event listeners for debugging
              transport.on("connectionstatechange", (state) => {
                console.log("[sendTransport] Connection state:", state);
              });

              transport.on("icegatheringstatechange", (state) => {
                console.log("[sendTransport] ICE gathering state:", state);
              });

              transport.on("iceconnectionstatechange", (state) => {
                console.log("[sendTransport] ICE connection state:", state);
              });

              sendTransportRef.current = transport;
              setSendTransport(transport);
              console.log(
                "[initializeRoom] Send transport created with TURN support"
              );
            }
          );

          // Create receive transport with TURN server configuration
          socket.emit(
            "createWebRtcTransport",
            { roomId, direction: "recv" },
            (params) => {
              if (params.error) {
                console.error(
                  "[initializeRoom] Recv transport error:",
                  params.error
                );
                return;
              }

              console.log(
                "[initializeRoom] Creating recv transport with TURN servers"
              );

              const transport = _device.createRecvTransport({
                ...params,
                iceServers,
                iceTransportPolicy: "all", // Allow both UDP and TCP
                iceCandidatePoolSize: 10, // Increase candidate pool for better connectivity
                bundlePolicy: "balanced",
                rtcpMuxPolicy: "require",
              });

              transport.on("connect", ({ dtlsParameters }, cb) => {
                console.log("[recvTransport] Connecting...");
                socket.emit(
                  "connectWebRtcTransport",
                  { roomId, transportId: params.id, dtlsParameters },
                  (result) => {
                    console.log("[recvTransport] Connect result:", result);
                    cb(result);
                  }
                );
              });

              // Additional transport event listeners for debugging
              transport.on("connectionstatechange", (state) => {
                console.log("[recvTransport] Connection state:", state);
              });

              transport.on("icegatheringstatechange", (state) => {
                console.log("[recvTransport] ICE gathering state:", state);
              });

              transport.on("iceconnectionstatechange", (state) => {
                console.log("[recvTransport] ICE connection state:", state);
              });

              recvTransportRef.current = transport;
              setRecvTransport(transport);
              console.log(
                "[initializeRoom] Recv transport created with TURN support"
              );

              setTimeout(() => consumePending(), 500);
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
      initializedRef.current = false;
    };
  }, [roomId, mySocketId]);

  useEffect(() => {
    console.log("[useEffect] recvTransport updated", {
      id: recvTransport?.id,
      closed: recvTransport?.closed,
    });
    if (recvTransport) {
      setTimeout(() => consumePending(), 300);
    }
  }, [recvTransport, consumePending]);

  useEffect(() => {
    let localStream;
    let mediaStreamRef = null;

    if (!sendTransport) return;

    (async () => {
      if (sendTransport.closed) return;
      try {
        console.log("[localStream] Starting media capture...");

        const userStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 1,
            latency: 0.01,
            volume: 1.0,
          },
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
          },
        });

        mediaStreamRef = userStream;
        const audioTrack = userStream.getAudioTracks()[0];
        const videoTrack = userStream.getVideoTracks()[0];
        localStream = new MediaStream();

        if (audioTrack) {
          audioTrack.enabled = true;

          audioTrack.addEventListener("mute", () => {
            console.log("[localStream] Audio track muted");
          });

          audioTrack.addEventListener("unmute", () => {
            console.log("[localStream] Audio track unmuted");
          });

          audioTrack.addEventListener("ended", () => {
            console.log("[localStream] Audio track ended");
          });

          localStream.addTrack(audioTrack);

          console.log("[localStream] Added microphone audio track:", {
            id: audioTrack.id,
            kind: audioTrack.kind,
            enabled: audioTrack.enabled,
            muted: audioTrack.muted,
            readyState: audioTrack.readyState,
            settings: audioTrack.getSettings(),
            constraints: audioTrack.getConstraints(),
          });

          const audioContext = new (window.AudioContext ||
            window.webkitAudioContext)();
          const source = audioContext.createMediaStreamSource(
            new MediaStream([audioTrack])
          );
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const checkAudioLevel = () => {
            analyser.getByteFrequencyData(dataArray);
            const average =
              dataArray.reduce((a, b) => a + b) / dataArray.length;
            if (average > 0) {
              console.log("[localStream] Audio level detected:", average);
            }
          };

          const levelCheck = setInterval(checkAudioLevel, 1000);
          setTimeout(() => clearInterval(levelCheck), 5000);
        } else {
          console.error("[localStream] No audio track found!");
          return;
        }

        if (videoTrack) {
          videoTrack.enabled = true;
          localStream.addTrack(videoTrack);
          console.log("[localStream] Added video track:", {
            id: videoTrack.id,
            kind: videoTrack.kind,
            enabled: videoTrack.enabled,
            muted: videoTrack.muted,
            readyState: videoTrack.readyState,
            settings: videoTrack.getSettings(),
          });
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
          localVideoRef.current.volume = 0;
          await localVideoRef.current
            .play()
            .catch((e) => console.error("[localStream] Play error:", e));
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));

        const producerPromises = [];

        for (const track of localStream.getTracks()) {
          console.log(
            `[localStream] Creating producer for ${track.kind} track:`,
            {
              id: track.id,
              enabled: track.enabled,
              readyState: track.readyState,
              muted: track.muted,
            }
          );

          let produceOptions = { track };

          if (track.kind === "audio") {
            produceOptions.codecOptions = {
              opusStereo: 1,
              opusDtx: 1,
              opusFec: 1,
              opusMaxPlaybackRate: 48000,
            };

            produceOptions.appData = {
              source: "microphone",
              trackId: track.id,
            };
          }

          const producerPromise = sendTransport
            .produce(produceOptions)
            .then((producer) => {
              console.log(
                `[localStream] ${track.kind} producer created successfully:`,
                {
                  id: producer.id,
                  kind: producer.kind,
                  closed: producer.closed,
                  paused: producer.paused,
                  track: {
                    id: track.id,
                    enabled: track.enabled,
                    readyState: track.readyState,
                    muted: track.muted,
                  },
                }
              );

              producer.on("close", () => {
                console.log(
                  `[localStream] ${track.kind} producer closed:`,
                  producer.id
                );
              });

              producer.on("pause", () => {
                console.log(
                  `[localStream] ${track.kind} producer paused:`,
                  producer.id
                );
              });

              producer.on("resume", () => {
                console.log(
                  `[localStream] ${track.kind} producer resumed:`,
                  producer.id
                );
              });

              if (producer.paused) {
                producer.resume();
              }

              return producer;
            })
            .catch((error) => {
              console.error(
                `[localStream] Error creating ${track.kind} producer:`,
                error
              );
              throw error;
            });

          producerPromises.push(producerPromise);
        }

        const createdProducers = await Promise.all(producerPromises);

        setProducers((prevProducers) => {
          const newProducers = [...prevProducers, ...createdProducers];
          console.log(
            "[localStream] All producers created. Total:",
            newProducers.length
          );
          return newProducers;
        });
      } catch (error) {
        console.error("[localStream] Error getting media:", error);

        if (
          error.name === "NotFoundError" ||
          error.name === "DevicesNotFoundError"
        ) {
          console.log("[localStream] Trying audio-only fallback...");
          try {
            const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
              },
            });

            const audioTrack = audioOnlyStream.getAudioTracks()[0];
            if (audioTrack) {
              audioTrack.enabled = true;
              const producer = await sendTransport.produce({
                track: audioTrack,
                codecOptions: { opusStereo: 1, opusDtx: 1, opusFec: 1 },
              });
              setProducers((prev) => [...prev, producer]);
              console.log(
                "[localStream] Audio-only producer created:",
                producer.id
              );
            }
          } catch (audioError) {
            console.error(
              "[localStream] Audio-only fallback failed:",
              audioError
            );
          }
        }
      }
    })();

    return () => {
      console.log("[localStream] Cleaning up media streams...");
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          console.log(`[localStream] Stopping ${track.kind} track:`, track.id);
          track.stop();
        });
      }
      if (mediaStreamRef) {
        mediaStreamRef.getTracks().forEach((track) => {
          track.stop();
        });
      }
    };
  }, [sendTransport]);

  useEffect(() => {
    const onClosed = ({ socketId }) => {
      console.log("[producerClosed] removing", socketId);
      setConsumers((c) => c.filter((x) => x.socketId !== socketId));
    };
    socket.on("producerClosed", onClosed);
    return () => socket.off("producerClosed", onClosed);
  }, []);

  return (
    <div className="flex flex-col gap-4 h-dvh w-dvw p-4 bg-zinc-950">
      <VideoGrid
        consumers={consumers}
        localVideoRef={localVideoRef}
        mySocketId={mySocketId}
        audioContext={audioContext}
      />
      <Controls producers={producers} />
    </div>
  );
});
