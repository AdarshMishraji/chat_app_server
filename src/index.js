const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const cookie_parser = require("cookie-parser");
const express_rate_limit = require("express-rate-limit");

const auth = require("./Utils/auth");
const socket = require("./Utils/socket");
const {
    onUserJoined,
    onJoinWithUsers,
    fetchRoomMessages,
    onMessageRecieved,
    deleteMessage,
} = require("./Utils/eventHandlers");

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
const server = http.createServer(app);
const io = socket(server);
// app.use(limiter);
app.use(express.json());
app.use(cookie_parser(process.env.SECRET_KEY));

dotenv.config();

const PORT = process.env.PORT;

io.on("connection", (socket) => {
    const token = socket.handshake.auth.token;
    console.log("new web socket connection");

    // socket.on("ping", (a) => {
    //     console.log("ping");
    //     setTimeout(() => {
    //         socket.emit("ping", a);
    //     }, 1000);
    // });

    socket.on("user_joined", () => {
        onUserJoined(token, socket);
    });
    socket.on("join_with_user", ({ user_id }) => {
        onJoinWithUsers(user_id, token, socket, io);
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
    });
    socket.on("delete_message", ({ room_id, message_id }, callback) => {
        deleteMessage(room_id, message_id)
            .then(({ messages }) => {
                socket.broadcast.to(room_id).emit("room_chats", { messages });
                callback({ messages });
            })
            .catch((e) => callback({ error: e }));
    });
});

app.use(auth);

app.all("*", (req, res) => {
    res.send("Nothing");
});

server.listen(PORT, () => {
    console.log("Server running at: " + PORT + " " + new Date());
});

/*
 *  on disconnect
 *    inform others
 */
