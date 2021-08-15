const jwt = require("jsonwebtoken");
const adminSdk = require("../Configs/firebase");
const mysqlInstance = require("../Configs/db");
const { v4: uuidv4 } = require("uuid");

const getUserDataFromJWT = (token) => {
    return jwt.verify(token, process.env.SECRET_KEY);
};

const fetchUserFromUsername = (username, requiredFields) => {
    return new Promise((resolve, reject) => {
        console.log(
            `select ${
                requiredFields === "all" ? "*" : requiredFields
            } from users_table where username="${username}"`
        );
        mysqlInstance.query(
            `select ${
                requiredFields === "all" ? "*" : requiredFields
            } from users_table where username="${username}"`,
            (error1, response1) => {
                if (error1) {
                    console.log("search user", error1.message);
                    reject({ error: error1.message });
                    return;
                }
                resolve({ response: response1 });
                return;
            }
        );
    });
};

const fetchUserFromUserID = (user_id, requiredFields) => {
    return new Promise((resolve, reject) => {
        console.log(
            `select ${
                requiredFields === "all" ? "*" : requiredFields
            } from users_table where user_id="${user_id}"`
        );
        if (typeof user_id === "string") {
            mysqlInstance.query(
                `select ${
                    requiredFields === "all" ? "*" : requiredFields
                } from users_table where user_id="${user_id}"`,
                (error1, response1) => {
                    if (error1) {
                        console.log("search user", error1.message);
                        reject({ error: error1.message });
                        return;
                    }
                    resolve({ response: response1 });
                    return;
                }
            );
        } else {
            mysqlInstance.query(
                `select ${
                    requiredFields === "all" ? "*" : requiredFields
                } from users_table where user_id in (${user_id.map(
                    (id) => `"${id}"`
                )})`,
                (error1, response1) => {
                    if (error1) {
                        console.log("search user", error1.message);
                        reject({ error: error1.message });
                        return;
                    }
                    resolve({ response: response1 });
                    return;
                }
            );
        }
    });
};

const updateToken = (token, user_id) => {
    return new Promise((resolve, reject) => {
        const query = `update users_table set jwt_token="${token}" ${
            token === "" ? `, fcm_token=""` : ""
        } where user_id="${user_id}"`;
        console.log("update token query", query);
        mysqlInstance.query(query, (error1, response1) => {
            if (error1) {
                console.log("update user error", error1);
                reject({ error: error1.message });
                return;
            }
            console.log("after logged in", response1.affectedRows);
            resolve({ response: response1 });
            return;
        });
    });
};

const verifyToken = (token, fcm_token) => {
    return new Promise((resolve, reject) => {
        const data = getUserDataFromJWT(token);
        if (data) {
            mysqlInstance.query(
                `select * from logged_in_users where user_id="${data.user_id}" and jwt_token="${token}"`,
                (error1, response1) => {
                    if (error1) {
                        console.log("fetching user from db", error1);
                        reject({ error: error1.message });
                        return;
                    }
                    if (response1.length === 0) {
                        resolve({
                            error: "Token was expired, as user logged out from somewhere",
                        });
                        return;
                    }
                    console.log("after verifying token", response1[0]);
                    if (response1[0].fcm_token !== fcm_token) {
                        mysqlInstance.query(
                            `update users_table set fcm_token="${fcm_token}" where user_id="${data.user_id}"`,
                            (error2, response2) => {
                                if (error2) {
                                    console.log(
                                        "update user from db",
                                        error2.message
                                    );
                                    reject({ error: error2.message });
                                    return;
                                }
                                console.log(
                                    "after updating users fcm",
                                    response2.affectedRows
                                );
                                resolve({ user: data });
                                return;
                            }
                        );
                    }
                    resolve({ user: data });
                    return;
                }
            );
        } else {
            reject({ error: "Not Verified" });
            return;
        }
    });
};

const fetchRoomMessages = (room_id) => {
    console.log(room_id);
    return new Promise((resolve, reject) => {
        const query = `select message_id, cast(aes_decrypt(message, "${room_id}_${process.env.SECRET_KEY}")as char) as message, type, send_at, room_id, from_user_id, from_username from messages_table where room_id="${room_id}"`;
        console.log(query);
        mysqlInstance.query(query, (error1, response1) => {
            if (error1) {
                console.log("fetch messages", error1.message);
                reject({ error: error1.message });
                return;
            }
            resolve({ messages: response1 });
            return;
        });
    });
};

const createAndJoinRoom = (my_user_id, other_user_id, type, groupName) => {
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
                    console.log("inside type string", type);
                    mysqlInstance.query(
                        `insert into users_rooms_table values 
            ("${room_id}", "${my_user_id}", "duet", "")
            ${
                other_user_id
                    ? `,("${room_id}", "${other_user_id}", "duet", "")}`
                    : ""
            }`,
                        (error2, response2) => {
                            resolve({
                                message: "connected to room",
                                room_id,
                                e,
                            });
                            return;
                        }
                    );
                } else {
                    console.log("type object", other_user_id);
                    mysqlInstance.query(
                        `insert into users_rooms_table value
                        ("${room_id}", "${my_user_id}", "group", "${groupName}"),
                        ${other_user_id.map((id) => {
                            return `("${room_id}", "${id}", "group", "${groupName}")`;
                        })}
                        `,
                        (error2, response2) => {
                            console.log(
                                "after insert room",
                                response2.affectedRows
                            );
                            resolve({
                                message: "connected to room",
                                room_id,
                            });
                            return;
                        }
                    );
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
                    const users = {};
                    const per_room = {};
                    const room_names = {};
                    for (let i = 0; i < response1.length; i++) {
                        let room_id = response1[i].room_id;
                        let user_id = response1[i].user_id;
                        if (per_room[room_id] === undefined) {
                            per_room[room_id] = {
                                room_type: response1[i].room_type,
                                users: [],
                            };
                        }
                        if (users[user_id] === undefined) {
                            users[user_id] = {};
                        }
                        per_room[room_id].users.push({
                            user_id,
                        });
                        room_names[room_id] = response1[i].room_name;
                    }
                    const user_ids = JSON.stringify(Object.keys(users))
                        .replace("[", "")
                        .replace("]", "");

                    const room_ids = JSON.stringify(Object.keys(room_names))
                        .replace("[", "")
                        .replace("]", "");

                    let new_res = [];

                    const promises = [
                        userWithUserdIDs(user_ids, per_room, users),
                        fetchLastMessage(room_ids),
                    ];

                    Promise.all(promises).then((res) => {
                        console.log("promise all", res);
                        let per_room_data = res[0].response;
                        let room_last_msg = res[1].room_last_msg;

                        for (const [key, value] of Object.entries(
                            per_room_data
                        )) {
                            new_res.push({
                                room_id: key,
                                type: value.room_type,
                                room_name: room_names[key],
                                users: value.users,
                                last_msg: room_last_msg[key],
                            });
                        }
                        resolve({ response: new_res });
                    });
                } else {
                    resolve({ response: response1 }); // empty array.
                }
            }
        );
    });
};

const userWithUserdIDs = (user_ids, per_room, users) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `select ut.user_id, ut.username, ut.name from users_table ut where ut.user_id in (${user_ids}) order by user_id`,
            (error, response) => {
                if (error) {
                    console.log("fetch common2", error.message);
                    reject({ error: error.message });
                    return;
                }
                if (response.length > 0) {
                    // const new_res = [];
                    //             const per_room = {};
                    for (let i = 0; i < response.length; i++) {
                        users[response[i].user_id] = {
                            username: response[i].username,
                            name: response[i].name,
                        };
                    }
                    for (const [key, value] of Object.entries(per_room)) {
                        per_room[key].users.forEach((ele, index) => {
                            let data = {
                                user_id: ele.user_id,
                                username: users[ele.user_id].username,
                                name: users[ele.user_id].name,
                            };
                            per_room[key].users[index] = data;
                        });
                    }
                    console.log("per_room", per_room);
                    resolve({ response: per_room });
                } else {
                    resolve({ response: response }); // empty array.
                }
            }
        );
    });
};

const fetchLastMessage = (room_ids) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `select message_id, cast(aes_decrypt(message, concat( room_id , "_${process.env.SECRET_KEY}"))as char) as message, type, send_at, room_id, from_user_id, from_username 
                from messages_table where room_id in (${room_ids}) and message_id in (select max(message_id) from messages_table mt where true group by room_id);`,
            (error, response) => {
                if (error) {
                    console.log("fetch last msg", error.message);
                    reject({ error: error.message });
                    return;
                }
                const room_last_msg = {};
                response.forEach((ele) => {
                    room_last_msg[ele.room_id] = { ...ele };
                });
                resolve({ room_last_msg });
            }
        );
    });
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

const fetchOtherRoomUsers = (room_id, my_user_id, requiredFields) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `select ${requiredFields} from users_table where user_id in (select user_id from users_rooms_table where room_id = "${room_id}" and user_id != "${my_user_id}")`,
            (error, response) => {
                if (error) {
                    console.log("fetch other room", error.message);
                    reject({ error: error.message });
                    return;
                }
                console.log("other room users", response);
                resolve({ other_room_users: response });
                return;
            }
        );
    });
};

const sendMessageToAllOnUserSignup = (username, user_id) => {
    mysqlInstance.query(
        `select fcm_token from users_table where user_id != "${user_id || ""}"`,
        (error, response) => {
            if (error) {
                console.log("error while fetching others fcm", error.message);
                return;
            }
            const fcm_tokens = [];
            response.forEach((item, index) => {
                console.log(index, item.fcm_token);
                if (item.fcm_token !== "") {
                    fcm_tokens.push(item.fcm_token);
                }
            });
            console.log("fcmTokens", fcm_tokens);
            if (fcm_tokens.length > 0) {
                adminSdk
                    .messaging()
                    .sendToDevice(fcm_tokens, {
                        notification: {
                            title: "New User has joined",
                            body: username + " has joined. Say hi!",
                        },
                    })
                    .then((a) => console.log(a))
                    .catch((e) => console.log(e));
            }
            return;
        }
    );
};

const sendMessage = (message, socket, io) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `
        insert into messages_table
            (message, type, send_at, room_id, from_user_id, from_username)
        values (aes_encrypt("${message.message}", "${message.room_id}_${process.env.SECRET_KEY}"), "${message.type}", "${message.send_at}", "${message.room_id}", "${message.from_user_id}", "${message.from_username}")`,
            (error1, response1) => {
                if (error1) {
                    console.log("message", error1.message);
                    socket.emit("message_error", { error: error1.message });
                    reject({ error: error1.message });
                    return;
                }
                console.log("message added", response1.affectedRows);
                io.to(message.room_id).emit("new_message", {
                    message,
                });
                resolve();
                console.log("after resolve");
                fetchOtherRoomUsers(
                    message.room_id,
                    message.from_user_id,
                    "fcm_token"
                )
                    .then(({ other_room_users }) => {
                        io.emit("refresh_all", {
                            changed_by: message.from_user_id,
                            type: "chat_update",
                        });
                        console.log("other room users", other_room_users);
                        const fcm_tokens = [];
                        other_room_users.forEach(({ fcm_token }) => {
                            if (fcm_token !== "") {
                                fcm_tokens.push(fcm_token);
                            }
                        });

                        adminSdk.messaging().sendToDevice(fcm_tokens, {
                            notification: {
                                title:
                                    "New Message from " + message.from_username,
                                body: message.message,
                            },
                        });
                    })
                    .then((a) => console.log(a))
                    .catch((e) => console.log(e));
            }
        );
    });
};

const insertUserIntoRoom = (room_id, other_user_id, room_type, io) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `insert into users_rooms_table value ("${room_id}", "${other_user_id}", "${room_type}", "")`,
            (error, response) => {
                if (error) {
                    console.log("error while insert user", error.message);
                    reject({ error: error.message });
                    return;
                }
                io.emit("refresh_all", {
                    type: "chat_update",
                    changed_by: null,
                });
                resolve({ response: response.affectedRows });
                return;
            }
        );
    });
};

module.exports = {
    getUserDataFromJWT,
    verifyToken,
    fetchUserFromUsername,
    fetchUserFromUserID,
    updateToken,
    fetchRoomMessages,
    createAndJoinRoom,
    fetchCommonRoomAndJoinedUsers,
    fetchAllUsers,
    deleteMessage,
    fetchOtherRoomUsers,
    sendMessageToAllOnUserSignup,
    sendMessage,
    insertUserIntoRoom,
};
