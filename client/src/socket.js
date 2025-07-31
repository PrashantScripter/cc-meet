import { io } from "socket.io-client";

const CLIENT = import.meta.env.VITE_SERVER_URL;

const socket = io(
  CLIENT,
  {
    withCredentials: true,
    transports: ["websocket", "polling"],
  },
  { reconnect: false }
);

export default socket;
