const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const cookie_parser = require("cookie-parser");
const express_rate_limit = require("express-rate-limit");
const { ExpressPeerServer } = require("peer");

const auth = require("./Utils/auth");
const socket = require("./Configs/socket");
const {
    onUserJoined,
    onJoinWithUsers,
    onMessageRecieved,
    deleteMessage,
    onDeleteRoom,
    onRoomRequest,
    onInviteUser,
    onInvitationApproved,
    onInvitationRejected,
} = require("./Utils/eventHandlers");
const {
    fetchRoomMessages,
    setActiveStatus,
    getUserDataFromJWT,
    fetchAllUsers,
} = require("./Utils/helpers");

dotenv.config();

const PORT = process.env.PORT;

const app = express();
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS, PUT, PATCH, DELETE"
    );
    res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept"
    );
    next();
});
app.use(cors());

const limiter = express_rate_limit({
    max: 60,
    windowMs: 1000 * 60,
    message: { error: "Too many attempts, please try again later." },
});

const server = app.listen(PORT, () => {
    console.log("Server running at: " + PORT + " " + new Date());
});

const io = socket(server);
const peerServer = ExpressPeerServer(server, { port: 443 });

app.use(limiter);
app.use(express.json());
app.use((req, res, next) => {
    res.locals.io = io;
    next();
});
app.use(cookie_parser(process.env.SECRET_KEY));
app.use("/peerjs", peerServer);

peerServer.on("connection", (client) => {
    console.log("peer server connected to client", client.getId());
});

peerServer.on("error", (e) => {
    console.log("peer error", e.message);
});

peerServer.on("disconnect", (client) => {
    console.log("peer disconnected", client.getId());
});

io.on("connection", (socket) => {
    const { token } = socket.handshake.auth;
    const user_details = getUserDataFromJWT(token);
    console.log("new web socket connection");

    // socket.on("ping", (a) => {
    //     console.log("ping");
    //     setTimeout(() => {
    //         socket.emit("ping", a);
    //     }, 1000);
    // });

    // common handlers
    socket.on("user_joined", () => {
        onUserJoined(user_details, socket);
        io.emit("refresh_all", {
            changed_by: user_details.user_id,
            type: "active_status",
        });
    });

    // message/room handlers
    socket.on("join_with_user", ({ user_id, groupName }) => {
        onJoinWithUsers(user_id, user_details, groupName, socket, io);
    });

    socket.on("room_request", () => {
        onRoomRequest(user_details, socket);
    });

    socket.on("all_users_request", () => {
        fetchAllUsers(user_details.user_id)
            .then(({ response }) => {
                console.log(response);
                socket.emit("all_users", { users: response });
            })
            .catch((e) => socket.emit("fetch_error", { error: e }));
    });

    socket.on("room_messages_request", ({ room_id }, callback) => {
        fetchRoomMessages(room_id)
            .then(({ messages }) => {
                callback({ messages });
            })
            .catch((e) => {
                console.log("error rmr", e);
                callback({ error: e });
            });
    });

    socket.on("room_message_send", ({ message }, callback) => {
        callback();
        onMessageRecieved(message, socket, io);
        // sendMessagesToInactive();
    });

    socket.on("delete_message", ({ room_id, message_id }, callback) => {
        deleteMessage(room_id, message_id)
            .then(({ messages }) => {
                socket.broadcast
                    .to(room_id)
                    .emit("room_chats", { room_id, messages });
                io.emit("refresh_all", {
                    changed_by: room_id,
                    type: "chat_update",
                });
                callback({ messages });
            })
            .catch((e) => callback({ error: e }));
    });

    socket.on("delete_room", ({ room_id }, callback) => {
        console.log("delete room", room_id);
        onDeleteRoom(room_id, user_details, socket, callback)
            .then(({ message }) => {
                console.log(message);
                socket.leave(room_id);
                io.emit("refresh_all", { changed_by: user_details.user_id });
            })
            .catch((e) => callback({ message: e }));
    });

    // call handlers
    // socket.on("start_call", ({ room_id, my_peer_id }) => {
    //     console.log("start-call", room_id, my_peer_id);
    //     socket.broadcast.to(room_id).emit("call_initiated", {
    //         initiators_details: {
    //             peer_id: my_peer_id,
    //             room_id,
    //             socket_id: socket.id,
    //         },
    //     });
    // });

    // socket.on(
    //     "join_call_request",
    //     ({ peer_id, host_socket_id, room_id, localStreamId }) => {
    //         io.to(room_id).emit("user_call_join_request", {
    //             peer_id,
    //             room_id,
    //             stream_id: localStreamId,
    //             host_socket_id,
    //         });
    //     }
    // );

    socket.on("typing_state", ({ state, user_id, room_id }) => {
        socket.broadcast
            .to(room_id)
            .emit("users_typing_state", { state, user_id, room_id });
    });

    socket.on(
        "invite_user",
        ({ room_id, room_name, invited_to_user_id, invited_to_username }) => {
            onInviteUser(
                user_details,
                room_id,
                room_name,
                invited_to_user_id,
                invited_to_username
            );
        }
    );

    socket.on("invitation_approved", ({ invitation_id }) => {
        onInvitationApproved(user_details, invitation_id, socket, io);
    });

    socket.on("invitation_rejected", ({ invitation_id }) => {
        onInvitationRejected(user_details, invitation_id);
    });

    socket.on("disconnect", () => {
        console.log("user disconnected");
        setActiveStatus(user_details.user_id, "offline")
            .then(() =>
                console.log(
                    "set active status",
                    user_details.user_id,
                    "offline"
                )
            )
            .catch((e) => console.log("set active status error", e));
        io.emit("refresh_all", {
            changed_by: user_details.user_id,
            type: "active_status",
        });
    });
});

app.use(auth);

app.all("*", (req, res) => {
    res.send("Nothing");
});
