const mysqlInstance = require("./db");
const {
    getUserDataFromJWT,
    fetchRoomMessages,
    createAndJoinRoom,
    fetchCommonRoomAndJoinedUsers,
    fetchAllUsers,
    deleteMessage,
} = require("./helpers");

const onUserJoined = (token, socket) => {
    const data = getUserDataFromJWT(token);
    fetchCommonRoomAndJoinedUsers(data.user_id)
        .then(({ response }) => {
            console.log("then");
            const room_ids = response.map((res) => {
                return res.room_id;
            });
            socket.join(room_ids);
            console.log(socket.rooms);
            socket.broadcast.to(room_ids).emit("a_user_joined", { user: data });
            socket.emit("room_people_data", { response });
            fetchAllUsers(data.user_id)
                .then(({ response }) => {
                    console.log(response);
                    socket.emit("all_users", { users: response });
                })
                .catch((e) => socket.emit("fetch_error", { error: e }));
            return;
        })
        .catch((e) => {
            console.log("error", e);
            socket.emit("fetch_error", { error: e });
        });
};

const onJoinWithUsers = (user_id, token, socket, io) => {
    console.log(user_id, user_id.length);
    const data = getUserDataFromJWT(token);
    if (typeof user_id === "object") {
        socket.emit("error", "not supported");
        createAndJoinRoom(data.user_id, user_id, "object")
            .then(({ room_id }) => {
                socket.join(room_id);
                console.log(socket.rooms);
                io.to(room_id).emit("room_created_and_joined", {
                    message: "a room is created and you have joined",
                    room_id,
                    type: "group",
                });
                fetchCommonRoomAndJoinedUsers(data.user_id).then(
                    ({ response }) => {
                        console.log("then");
                        socket.emit("room_people_data", {
                            response,
                        });
                    }
                );
                return;
            })
            .catch((e) => {
                console.log(e);
                socket.emit("fetch_error", { error: e });
            });
    } else {
        mysqlInstance.query(
            `select distinct(room_id) from users_rooms_table where user_id="${data.user_id}" and room_type='duet' and room_id = any(select room_id from users_rooms_table where user_id="${user_id}")`,
            (error1, response1) => {
                if (error1) {
                    console.log("on user joined", error1);
                    socket.emit("fetch_error", { error: error1 });
                    return;
                }
                console.log(response1);
                if (response1.length == 0) {
                    createAndJoinRoom(data.user_id, user_id, "string")
                        .then(({ room_id }) => {
                            console.log(room_id);
                            socket.join(room_id);
                            console.log(socket.rooms);
                            io.to(room_id).emit("room_created_and_joined", {
                                message:
                                    "a room is created and you have joined",
                                room_id,
                                type: "duet",
                            });
                            fetchCommonRoomAndJoinedUsers(data.user_id).then(
                                ({ response }) => {
                                    socket.emit("room_people_data", {
                                        response,
                                        type: "duet",
                                    });
                                }
                            );
                            return;
                        })
                        .catch((e) => {
                            console.log(e);
                            socket.emit("fetch_error", { error: e });
                        });
                } else {
                    fetchRoomMessages(response1[0].room_id)
                        .then(({ messages }) => {
                            console.log(
                                "all room chats",
                                messages,
                                response1[0].room_id
                            );
                            if (messages) {
                                socket.emit("room_chats", {
                                    room_id: response1[0].room_id,
                                    messages,
                                });
                            }
                            return;
                        })
                        .catch((e) => {
                            console.log(e);
                            socket.emit("fetch_error", { error: e });
                        });
                }
            }
        );
    }
};

const onMessageRecieved = (message, socket, io) => {
    console.log("message", message);
    mysqlInstance.query(
        `
        insert into messages_table
            (message, type, send_at, room_id, from_user_id, from_username)
        values ("${message.message}", "${message.type}", "${message.send_at}", "${message.room_id}", "${message.from_user_id}", "${message.from_username}")`,
        (error, response) => {
            if (error) {
                console.log("message", error.message);
                socket.emit("message_error", { error: error.message });
                return;
            }
            console.log("message added", response.affectedRows);
            io.to(message.room_id).emit("new_message", {
                message,
            });
        }
    );
};

const onDeleteRoom = (room_id, token, socket, callback) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `select message_id from messages_table where room_id="${room_id}"`,
            (e, r) => {
                if (e) {
                    reject({ error: e.message });
                    return;
                }
                if (r.length > 0) {
                    reject({ error: "room is not empty" });
                    return;
                }

                mysqlInstance.query(
                    `delete from users_rooms_table where room_id = "${room_id}"`,
                    (error1, response1) => {
                        if (error1) {
                            console.log("delete room", error1.message);
                            reject({ error: error1.message });
                            return;
                        }
                        console.log(
                            "delete room affect1",
                            response1.affectedRows
                        );
                        mysqlInstance.query(
                            `delete from rooms_table where room_id = "${room_id}"`,
                            (error2, response2) => {
                                if (error2) {
                                    console.log(
                                        "delete room 2",
                                        error2.message
                                    );
                                    reject({ error: error2.message });
                                    return;
                                }
                                console.log(
                                    "delete room affect1",
                                    response2.affectedRows
                                );
                                callback({ message: "Room deleted" });
                                onUserJoined(token, socket);
                                resolve({ message: "Room deleted" });
                            }
                        );
                    }
                );
            }
        );
    });
};

module.exports = {
    onUserJoined,
    onJoinWithUsers,
    onMessageRecieved,
    deleteMessage,
    onDeleteRoom,
};
