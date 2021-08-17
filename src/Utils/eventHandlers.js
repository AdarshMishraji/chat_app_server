const adminSdk = require("../Configs/firebase");
const mysqlInstance = require("../Configs/db");
const dotenv = require("dotenv");
dotenv.config();
const {
    fetchRoomMessages,
    createAndJoinRoom,
    fetchCommonRoomAndJoinedUsers,
    fetchAllUsers,
    deleteMessage,
    sendMessage,
    insertUserIntoRoom,
    setActiveStatus,
    addInvitation,
    fetchUserFromUserID,
    deleteInvitation,
    getInvitationDetails,
} = require("./helpers");

const onUserJoined = (data, socket) => {
    setActiveStatus(data.user_id, "online")
        .then(() => console.log("set active status", data.user_id, "online"))
        .catch((e) => console.log("set active status error", e));
    fetchCommonRoomAndJoinedUsers(data.user_id)
        .then(({ response }) => {
            console.log("then");
            const room_ids = response.map((res) => {
                return res.room_id;
            });
            socket.join(room_ids);
            console.log(socket.rooms);
            socket.emit("room_people_data", { response });
        })
        .catch((e) => {
            console.log("error", e);
            socket.emit("fetch_error", { error: e });
        });
    fetchAllUsers(data.user_id)
        .then(({ response }) => {
            console.log(response);
            socket.emit("all_users", { users: response });
        })
        .catch((e) => socket.emit("fetch_error", { error: e }));
};

const onJoinWithUsers = (user_id, data, groupName, socket, io) => {
    console.log(user_id, user_id.length);
    if (typeof user_id === "object") {
        socket.emit("error", "not supported");
        createAndJoinRoom(data.user_id, user_id, "object", groupName)
            .then(({ room_id }) => {
                socket.join(room_id);
                console.log(socket.rooms);
                fetchCommonRoomAndJoinedUsers(data.user_id).then(
                    ({ response }) => {
                        console.log("then");
                        socket.emit("room_people_data", {
                            response,
                        });
                        io.to(room_id).emit("room_created_and_joined", {
                            message: "a room is created and you have joined",
                            room_id,
                            type: "group",
                        });
                    }
                );

                sendMessage(
                    {
                        message: `${data.username} has created the group`,
                        type: "admin_msg",
                        room_id,
                        send_at: Date.now(),
                        from_user_id: "admin",
                        from_user_name: "admin",
                    },
                    socket,
                    io
                )
                    .then(() => console.log("message sent"))
                    .catch((e) => console.log("send msg error", e));

                return;
            })
            .catch((e) => {
                console.log(e);
                socket.emit("fetch_error", { error: e });
            });
    } else {
        mysqlInstance.query(
            `select distinct(room_id) from users_rooms_table where user_id="${data.user_id}" and room_type="duet" and room_id = any(select room_id from users_rooms_table where user_id="${user_id}")`,
            (error1, response1) => {
                if (error1) {
                    console.log("on user joined", error1);
                    socket.emit("fetch_error", { error: error1 });
                    return;
                }
                console.log("response", response1, response1.length);
                if (response1.length === 0) {
                    createAndJoinRoom(data.user_id, null, "string")
                        .then(({ room_id }) => {
                            console.log(room_id);
                            socket.join(room_id);
                            console.log(socket.rooms);
                            socket.emit("room_created_and_joined", {
                                message:
                                    "a room is created and you have joined",
                                room_id,
                                type: "duet",
                            });
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
                                socket.emit("room_chats_on_click", {
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

const onMessageRecieved = (message, socket, io, callback) => {
    console.log("message", message);
    if (
        message.room_type === "duet" &&
        message.action === "insert_other_user_into_duet_room"
    ) {
        insertUserIntoRoom(
            message.room_id,
            message.other_user_id,
            "normal",
            message.room_type,
            "",
            io
        )
            .then(() => console.log("user inserted"))
            .catch((e) => console.log(e));
    }
    sendMessage(message, socket, io)
        .then(() => {
            console.log("message sent");
            callback();
        })
        .catch((e) => console.log("message error", e));
};

const onDeleteRoom = (room_id, user_details, socket, callback) => {
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
                mysqlInstance.beginTransaction((err) => {
                    if (err) reject({ error: err.message });
                    mysqlInstance.query(
                        `delete from users_rooms_table where room_id = "${room_id}"`,
                        (error1, response1) => {
                            if (error1) {
                                console.log("delete room", error1.message);
                                mysqlInstance.rollback(() => {
                                    reject({ error: error1.message });
                                });
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
                                        mysqlInstance.rollback(() => {
                                            reject({ error: error2.message });
                                        });
                                        return;
                                    }
                                    mysqlInstance.commit((err) => {
                                        if (err) {
                                            console.log(
                                                "commit error",
                                                err.message
                                            );
                                            reject({ error: err.message });
                                            return;
                                        }
                                        console.log(
                                            "delete room affect1",
                                            response2.affectedRows
                                        );
                                        callback({ message: "Room deleted" });
                                        onUserJoined(user_details, socket);
                                        resolve({ message: "Room deleted" });
                                    });
                                }
                            );
                        }
                    );
                });
            }
        );
    });
};

const onRoomRequest = (data, socket) => {
    fetchCommonRoomAndJoinedUsers(data.user_id).then(({ response }) => {
        console.log("then");
        socket.emit("room_people_data", {
            response,
        });
    });
};

const onMakeAdmin = (user_details, user_id, room_id, io, callback) => {
    mysqlInstance.query(
        `select if (role = 'admin', 'true', 'false') as isAdmin from users_rooms_table urt where user_id = "${user_details.user_id}" and room_id = "${room_id}"`,
        (error, response) => {
            if (error) {
                callback({ error: error.message });
                return;
            }
            if (response[0].isAdmin === "true") {
                mysqlInstance.beginTransaction((err) => {
                    if (err) {
                        callback({ error: err.message });
                        return;
                    }
                    mysqlInstance.query(
                        `update users_rooms_table set role = "admin" where room_id = "${room_id}" and user_id = "${user_id}"`,
                        (error, response) => {
                            if (error) {
                                mysqlInstance.rollback(() => {
                                    callback({ error: error.message });
                                    return;
                                });
                            }
                            mysqlInstance.commit((err) => {
                                if (err) {
                                    callback({ error: error.message });
                                    return;
                                }
                                io.emit("refresh_all", {
                                    changed_by: user_details.user_id,
                                    type: "chat_update",
                                });
                                return;
                            });
                        }
                    );
                });
            } else {
                callback({ error: "You are not a admin" });
                return;
            }
        }
    );
};

const onInviteUser = (
    data,
    room_id,
    room_name,
    invited_to_user_id,
    invited_to_username
) => {
    addInvitation(
        data.user_id,
        data.username,
        invited_to_user_id,
        invited_to_username,
        room_id,
        room_name
    ).then(() => {
        fetchUserFromUserID(invited_to_user_id, "fcm_token").then(
            ({ response }) => {
                adminSdk.messaging().sendToDevice(response.fcm_token, {
                    notification: {
                        title: "Group Invitation",
                        body: `${data.username} is invited you to join the group "${room_name}"`,
                    },
                });
            }
        );
    });
};

const onInvitationApproved = (data, invitation_id, socket, io) => {
    getInvitationDetails(invitation_id).then(({ response }) => {
        deleteInvitation(invitation_id).then(() => {
            insertUserIntoRoom(
                response.group_room_id,
                response.invited_to_user_id,
                "group",
                response.group_room_name,
                io
            )
                .then(() => {
                    console.log("inserted");
                    io.emit("refresh_all", {
                        type: "chat_update",
                        changed_by: data.user_id,
                    });
                })
                .catch((e) => console.log("error invitation", e));

            sendMessage(
                {
                    message: `${data.username} has joined the group`,
                    type: "admin_msg",
                    room_id: response.group_room_id,
                    send_at: Date.now(),
                    from_user_id: "admin",
                    from_user_name: "admin",
                },
                socket,
                io
            )
                .then(() => console.log("message sent"))
                .catch((e) => console.log("send msg error", e));

            fetchUserFromUserID(response.invited_by_user_id, "fcm_token").then(
                ({ response }) => {
                    adminSdk.messaging().sendToDevice(response.fcm_token, {
                        notification: {
                            title: "Group Invitation Accepted",
                            body: `${data.username} has accepted your invitation for joining the group ${response.group_room_name}"`,
                        },
                    });
                }
            );
        });
    });
};

const onInvitationRejected = (data, invitation_id) => {
    getInvitationDetails(invitation_id).then(({ response }) => {
        deleteInvitation(invitation_id).then(() => {
            fetchUserFromUserID(response.invited_by_user_id, "fcm_token").then(
                ({ response }) => {
                    adminSdk.messaging().sendToDevice(response.fcm_token, {
                        notification: {
                            title: "Group Invitation Rejected",
                            body: `${data.username} has rejected your invitation for joining the group ${response.group_room_name}"`,
                        },
                    });
                }
            );
        });
    });
};

module.exports = {
    onUserJoined,
    onJoinWithUsers,
    onMessageRecieved,
    deleteMessage,
    onDeleteRoom,
    onRoomRequest,
    onInviteUser,
    onInvitationApproved,
    onInvitationRejected,
    onMakeAdmin,
};
