const mysqlInstance = require("./db");
const { getUserDataFromJWT, fetchUserFromUserID } = require("./helpers");
const { v4: uuidv4 } = require("uuid");

const onUserJoined = (token, socket) => {
    const data = getUserDataFromJWT(token);
    fetchCommonRoomAndJoinedUsers(data.user_id)
        .then(({ response }) => {
            console.log("then");
            // const new_res = [];
            // if (response.length > 0) {
            //     const per_room = {};
            const room_ids = response.map((res) => {
                return res.room_id;
            });
            //     console.log("per_room_data", per_room);

            //     for (const [key, value] of Object.entries(per_room)) {
            //         new_res.push({
            //             room_id: key,
            //             type: value.length > 1 ? "group" : "duet",
            //             name: "",
            //             users: value,
            //         });
            //     }
            //     console.log("new res", new_res);
            // }
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

const deleteMessage = (room_id, message_id) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `delete from messages_table where room_id="${room_id}" and message_id=${message_id}`,
            (error, response) => {
                if (error) {
                    console.log("delete msg", error.message);
                    reject({ error: error.message });
                    return;
                }
                console.log("delete message", response.affectedRows);
                fetchRoomMessages(room_id).then(({ messages }) => {
                    resolve({ messages });
                });
            }
        );
    });
};

// helpers
const fetchRoomMessages = (room_id) => {
    console.log(room_id);
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `select * from messages_table where room_id="${room_id}"`,
            (error1, response1) => {
                if (error1) {
                    console.log("fetch messages", error1.message);
                    reject({ error: error1.message });
                    return;
                }
                resolve({ messages: response1 });
                return;
            }
        );
    });
};

const createAndJoinRoom = (my_user_id, other_user_id, type) => {
    console.log("type", type);
    return new Promise((resolve, reject) => {
        const room_id = uuidv4();
        mysqlInstance.query(
            `insert into rooms_table values ("${room_id}")`,
            (error1, response1) => {
                if (error1) {
                    console.log("create room", error1.message);
                    reject({ error: error1.message });
                    return;
                }
                if (type === "string") {
                    mysqlInstance.query(
                        `insert into users_rooms_table values 
            ("${room_id}", "${my_user_id}", "duet"),
            ("${room_id}", "${other_user_id}", "duet")`,
                        (error2, response2) => {
                            fetchUserFromUserID(other_user_id, "username").then(
                                ({ response }) => {
                                    resolve({
                                        message: "connected to room",
                                        room_id,
                                        user: response,
                                    });
                                }
                            );
                        }
                    );
                    return;
                } else {
                    console.log("type object", other_user_id);
                    mysqlInstance.query(
                        `insert into users_rooms_table value
                        ("${room_id}", "${my_user_id}", "group"),
                        ${other_user_id.map((id) => {
                            return `("${room_id}", "${id}", "group")`;
                        })}
                        `,
                        (error2, response2) => {
                            console.log(
                                "after insert room",
                                response2.affectedRows
                            );
                            fetchUserFromUserID(other_user_id, "username").then(
                                ({ response }) => {
                                    resolve({
                                        message: "connected to room",
                                        room_id,
                                        user: response,
                                    });
                                    return;
                                }
                            );
                        }
                    );
                    // resolve({})
                    // reject({ error: "not supported" });
                }
            }
        );
    });
};

const fetchAllUsers = (user_id) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `select user_id, username, name from users_table where user_id != "${
                user_id || ""
            }"`,
            (error, response, fields) => {
                if (error) {
                    reject({ error: error.message });
                    return;
                }
                resolve({ response: response });
                return;
            }
        );
    });
};

const fetchCommonRoomAndJoinedUsers = (my_user_id) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `select * from users_rooms_table where room_id in (select room_id from users_rooms_table where user_id = "${my_user_id}") and user_id !="${my_user_id}" order by user_id;`,
            (error1, response1) => {
                if (error1) {
                    console.log("fetch common", error1.message);
                    reject({ error: error1.message });
                    return;
                }
                if (response1.length !== 0) {
                    // const users_ids = JSON.stringify(
                    //     response1.map((res) => `${res.user_id}`)
                    // )
                    //     .replace("[", "")
                    //     .replace("]", "");

                    const users = {};
                    const per_room = {};
                    for (let i = 0; i < response1.length; i++) {
                        let room_id = response1[i].room_id;
                        let user_id = response1[i].user_id;
                        if (per_room[room_id] === undefined) {
                            per_room[room_id] = [];
                        }
                        if (users[user_id] === undefined) {
                            users[user_id] = {};
                        }
                        per_room[room_id].push({
                            user_id,
                        });
                    }
                    const user_ids = JSON.stringify(Object.keys(users))
                        .replace("[", "")
                        .replace("]", "");

                    mysqlInstance.query(
                        `select ut.user_id, ut.username, ut.name from users_table ut where ut.user_id in (${user_ids}) order by user_id`,
                        (error2, response2) => {
                            if (error2) {
                                console.log("fetch common2", error1.message);
                                reject({ error: error2.message });
                                return;
                            }
                            if (response2.length > 0) {
                                const new_res = [];
                                //             const per_room = {};
                                for (let i = 0; i < response2.length; i++) {
                                    users[response2[i].user_id] = {
                                        username: response2[i].username,
                                        name: response2[i].name,
                                    };
                                }
                                for (const [key, value] of Object.entries(
                                    per_room
                                )) {
                                    per_room[key].forEach((ele, index) => {
                                        let data = {
                                            user_id: ele.user_id,
                                            username:
                                                users[ele.user_id].username,
                                            name: users[ele.user_id].name,
                                        };
                                        per_room[key][index] = data;
                                    });
                                }
                                console.log("per_room", per_room);
                                //                 if (
                                //                     per_room[response1[i].room_id] ===
                                //                     undefined
                                //                 ) {
                                //                     per_room[response1[i].room_id] = [];
                                //                 }
                                //                 per_room[response1[i].room_id].push({
                                //                     username: response2[i].username,
                                //                     user_id: response2[i].user_id,
                                //                     name: response2[i].name,
                                //                 });
                                //             console.log("per_room_data", per_room);

                                for (const [key, value] of Object.entries(
                                    per_room
                                )) {
                                    new_res.push({
                                        room_id: key,
                                        type:
                                            value.length > 1 ? "group" : "duet",
                                        name: "",
                                        users: value,
                                    });
                                }
                                console.log("new res", new_res);
                                resolve({ response: new_res });
                            } else {
                                resolve({ response: response1 }); // empty array.
                            }
                        }
                    );
                } else {
                    resolve({ response: response1 }); // empty array.
                }
            }
        );
    });
};
module.exports = {
    onUserJoined,
    onJoinWithUsers,
    fetchRoomMessages,
    onMessageRecieved,
    deleteMessage,
};
