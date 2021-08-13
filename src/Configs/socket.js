const socketio = require("socket.io");

const socket = (server) => {
    return new socketio.Server(server, {
        cors: true,
    }).sockets;
};

module.exports = socket;
