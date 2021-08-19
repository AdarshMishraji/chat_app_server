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
                    if (response1.length > 0) {
                        console.log("fetch user res", response1[0]);
                        resolve({ response: response1[0] });
                        return;
                    } else {
                        reject({ error: "no user found" });
                        return;
                    }
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
        mysqlInstance.beginTransaction((err) => {
            if (err) reject({ error: err.message });
            mysqlInstance.query(query, (error1, response1) => {
                if (error1) {
                    console.log("update user error", error1);
                    mysqlInstance.rollback(() => {
                        reject({ error: error1.message });
                    });
                    return;
                }
                console.log("after updating token", response1.affectedRows);
                mysqlInstance.commit((err) => {
                    if (err) {
                        console.log("commit error", err.message);
                        reject({ error: err.message });
                        return;
                    }
                    console.log("commited");
                    resolve({ response: response1 });
                });
                return;
            });
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
                        mysqlInstance.beginTransaction((err) => {
                            if (err) {
                                reject({ error: err.message });
                                return;
                            }
                            mysqlInstance.query(
                                `update users_table set fcm_token="${fcm_token}" where user_id="${data.user_id}"`,
                                (error2, response2) => {
                                    if (error2) {
                                        console.log(
                                            "update user from db",
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
                                        console.log("commited");
                                        console.log(
                                            "after updating users fcm",
                                            response2.affectedRows
                                        );
                                        resolve({ user: data });
                                    });
                                    return;
                                }
                            );
                        });
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

const fetchRoomMessages = (room_id, limit) => {
    console.log(room_id);
    return new Promise((resolve, reject) => {
        const query =
            `select message_id, cast(aes_decrypt(message, "${room_id}_${process.env.SECRET_KEY}")as char) as message, type, send_at, room_id, from_user_id, from_username, reply_to_message_id, cast(aes_decrypt(reply_to_message_text, "${room_id}_${process.env.SECRET_KEY}")as char) as reply_to_message_text, ` +
            "`seen-by_at` " +
            `from messages_table where room_id="${room_id}" order by send_at desc limit ${limit}`;
        console.log(query);
        mysqlInstance.query(query, (error1, response1) => {
            if (error1) {
                console.log("fetch messages", error1.message);
                reject({ error: error1.message });
                return;
            }
            response1.reverse();
            resolve({ messages: response1 });
            return;
        });
    });
};

const createAndJoinRoom = (my_user_id, other_user_id, type, groupName) => {
    console.log("type", type);
    return new Promise((resolve, reject) => {
        const room_id = uuidv4();
        mysqlInstance.beginTransaction((err) => {
            if (err) {
                reject({ error: err.message });
            }
            if (type === "string") {
                mysqlInstance.query(
                    `insert into rooms_table values ("${room_id}", "duet", "")`,
                    (error1, response1) => {
                        if (error1) {
                            console.log("create room", error1.message);
                            mysqlInstance.rollback(() => {
                                reject({ error: error1.message });
                            });
                            return;
                        }
                        console.log("inside type string", type);
                        mysqlInstance.query(
                            `insert into users_rooms_table values 
                    ("${room_id}", "${my_user_id}", "normal")
                    ${
                        other_user_id
                            ? `,("${room_id}", "${other_user_id}", "normal")`
                            : ""
                    }`,
                            (error2, response2) => {
                                if (error2) {
                                    console.log(
                                        "insert into room",
                                        error2.message
                                    );
                                    mysqlInstance.rollback(() => {
                                        reject({
                                            error: error2.message,
                                        });
                                        return;
                                    });
                                }
                                console.log(
                                    "after insert room",
                                    response2.affectedRows
                                );
                                mysqlInstance.commit((err) => {
                                    if (err) {
                                        console.log(
                                            "commit error",
                                            err.message
                                        );
                                        reject({ error: err.message });
                                        returnl;
                                    }
                                    console.log("commited");
                                    resolve({
                                        message: "connected to room",
                                        room_id,
                                    });
                                });
                                return;
                            }
                        );
                    }
                );
            } else {
                console.log("type object", other_user_id);
                mysqlInstance.query(
                    `insert into rooms_table values ("${room_id}", "group", "${groupName}")`,
                    (error1, response1) => {
                        if (error1) {
                            console.log("create room", error1.message);
                            mysqlInstance.rollback(() => {
                                reject({ error: error1.message });
                            });
                            return;
                        }
                        const query = `insert into users_rooms_table value
                                ("${room_id}", "${my_user_id}", "admin"),
                                ${other_user_id.map((id) => {
                                    return `("${room_id}", "${id}", "normal")`;
                                })}
                                `;
                        console.log("query", query);
                        mysqlInstance.query(query, (error2, response2) => {
                            if (error2) {
                                console.log("insert into room", error2.message);
                                mysqlInstance.rollback(() => {
                                    reject({
                                        error: error2.message,
                                    });
                                });
                                return;
                            }
                            console.log(
                                "after insert room",
                                response2.affectedRows
                            );
                            mysqlInstance.commit((err) => {
                                if (err) {
                                    console.log("commit error", err.message);
                                    reject({ error: err.message });
                                    return;
                                }
                                console.log("commited");
                                resolve({
                                    message: "connected to room",
                                    room_id,
                                });
                            });
                            return;
                        });
                    }
                );
            }
        });
    });
};

const fetchAllUsers = (user_id) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `select user_id, username, name, active_status from users_table where user_id != "${
                user_id || ""
            }"`,
            (error, response) => {
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
            `select * from users_rooms_table where room_id in (select room_id from users_rooms_table where user_id = "${my_user_id}") order by user_id`,
            (error1, response1) => {
                if (error1) {
                    console.log("fetch common", error1.message);
                    reject({ error: error1.message });
                    return;
                }
                if (response1.length !== 0) {
                    const users = {};
                    const per_room = {};
                    for (let i = 0; i < response1.length; i++) {
                        let room_id = response1[i].room_id;
                        let user_id = response1[i].user_id;
                        if (per_room[room_id] === undefined) {
                            per_room[room_id] = {
                                users: [],
                            };
                        }
                        if (users[user_id] === undefined) {
                            users[user_id] = {};
                        }
                        per_room[room_id].users.push({
                            user_id,
                            role: response1[i].role,
                        });
                    }
                    const user_ids = JSON.stringify(Object.keys(users))
                        .replace("[", "(")
                        .replace("]", ")");

                    const room_ids = JSON.stringify(Object.keys(per_room))
                        .replace("[", "(")
                        .replace("]", ")");

                    mysqlInstance.query(
                        `select * from rooms_table where room_id in ${room_ids}`,
                        (err, res) => {
                            if (err) {
                                console.log("fetch room det", err.message);
                                reject({ error: error1.message });
                                return;
                            }

                            for (let i = 0; i < res.length; i++) {
                                let room_id = res[i].room_id;
                                per_room[room_id] = {
                                    ...per_room[room_id],
                                    type: res[i].room_type,
                                    room_name: res[i].room_name,
                                };
                            }
                        }
                    );

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
                                ...value,
                                last_msg: room_last_msg[key],
                            });
                        }
                        new_res.sort(
                            (a, b) => b.last_msg.send_at - a.last_msg.send_at
                        );
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
            `select ut.user_id, ut.username, ut.name from users_table ut where ut.user_id in ${user_ids} order by user_id`,
            (error, response) => {
                if (error) {
                    console.log("fetch common2", error.message);
                    reject({ error: error.message });
                    return;
                }
                if (response.length > 0) {
                    for (let i = 0; i < response.length; i++) {
                        users[response[i].user_id] = {
                            username: response[i].username,
                            name: response[i].name,
                        };
                    }
                    console.log("users", users);
                    for (const [key, value] of Object.entries(per_room)) {
                        per_room[key].users.forEach((ele, index) => {
                            let data = {
                                user_id: ele.user_id,
                                role: per_room[key].users[index].role,
                                ...users[ele.user_id],
                            };
                            per_room[key].users[index] = data;
                        });
                        console.log("per room key", key, per_room[key].users);
                    }
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
                from messages_table where room_id in ${room_ids} and send_at in (select max(send_at) from messages_table mt where true group by room_id);`,
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
        mysqlInstance.beginTransaction((err) => {
            if (err) reject({ error: err.message });
            mysqlInstance.query(
                `delete from messages_table where room_id="${room_id}" and message_id="${message_id}"`,
                (error, response) => {
                    if (error) {
                        console.log("delete msg", error.message);
                        mysqlInstance.rollback(() => {
                            reject({ error: error.message });
                        });
                        return;
                    }
                    console.log("delete message", response.affectedRows);
                    mysqlInstance.commit((err) => {
                        if (err) {
                            console.log("commit error", err.message);
                            reject({ error: err.message });
                            return;
                        }
                        console.log("commited");
                        fetchRoomMessages(room_id, 25).then(({ messages }) => {
                            resolve({ messages });
                        });
                    });
                }
            );
        });
    });
};

const fetchOtherRoomUsers = (room_id, my_user_id, requiredFields) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `select ${requiredFields} from users_table where user_id in (select user_id from users_rooms_table where room_id = "${room_id}" and user_id != "${my_user_id}")`,
            (error, response) => {
                if (error) {
                    console.log("fetch other room", error.message);
                    mysqlInstance.rollback();
                    reject({ error: error.message });
                    return;
                }
                mysqlInstance.commit((err) => {
                    if (err) {
                        console.log("commit error", err.message);
                    }
                    console.log("commited");
                });
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
        const message_id = uuidv4();
        const query =
            message.type === "reply_text"
                ? `insert into messages_table
            (message_id, message, type, send_at, room_id, from_user_id, from_username, reply_to_message_id, reply_to_message_text)
        values ("${message_id}", aes_encrypt("${message.message}", "${message.room_id}_${process.env.SECRET_KEY}"), "${message.type}", "${message.send_at}", "${message.room_id}", "${message.from_user_id}", "${message.from_username}", "${message.reply_to_message_id}",  aes_encrypt("${message.reply_to_message_text}", "${message.room_id}_${process.env.SECRET_KEY}"))`
                : `insert into messages_table
            (message_id, message, type, send_at, room_id, from_user_id, from_username)
        values ("${message_id}", aes_encrypt("${message.message}", "${message.room_id}_${process.env.SECRET_KEY}"), "${message.type}", "${message.send_at}", "${message.room_id}", "${message.from_user_id}", "${message.from_username}")`;
        mysqlInstance.beginTransaction((err) => {
            if (err) reject({ error: err.message });
            mysqlInstance.query(query, (error1, response1) => {
                if (error1) {
                    console.log("message", error1.message);
                    mysqlInstance.rollback(() => {
                        socket.emit("message_error", { error: error1.message });
                        reject({ error: error1.message });
                    });
                    return;
                }
                mysqlInstance.commit((err) => {
                    if (err) {
                        console.log("commit error", err.message);
                        reject({ error: err.message });
                        returnl;
                    }
                    console.log("commited");
                    console.log("message added", response1.affectedRows);
                    io.to(message.room_id).emit("new_message", {
                        message: {
                            ...message,
                            message_id,
                        },
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
                            let title =
                                message.type === "reply_text"
                                    ? message.from_username + " replied"
                                    : "New Message from " +
                                      message.from_username;
                            if (fcm_tokens.length > 0)
                                adminSdk.messaging().sendToDevice(fcm_tokens, {
                                    notification: {
                                        title,
                                        body: message.message,
                                    },
                                });
                        })
                        .then((a) => console.log(a))
                        .catch((e) => console.log(e));
                });
            });
        });
    });
};

const insertUserIntoRoom = (room_id, other_user_id, role, io) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.beginTransaction((err) => {
            if (err) reject({ error: err.message });
            mysqlInstance.query(
                `insert into users_rooms_table value ("${room_id}", "${other_user_id}", "${role}")`,
                (error, response) => {
                    if (error) {
                        console.log("error while insert user", error.message);
                        mysqlInstance.rollback(() => {
                            reject({ error: error.message });
                        });
                        return;
                    }
                    mysqlInstance.commit((err) => {
                        if (err) {
                            console.log("commit error", err.message);
                            reject({ error: error.message });
                            return;
                        }
                        console.log("commited", response.affectedRows);
                        io.emit("refresh_all", {
                            type: "chat_update",
                            changed_by: null,
                        });
                        resolve({ response: response.affectedRows });
                    });
                    return;
                }
            );
        });
    });
};

const setActiveStatus = (user_id, status) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `update users_table set active_status = "${status}" where user_id="${user_id}"`,
            (error, response) => {
                if (error) {
                    console.log("error while insert user", error.message);
                    reject({ error: error.message });
                    return;
                }
                resolve({ response: response.affectedRows });
                return;
            }
        );
    });
};

const addInvitation = (
    invited_by_user_id,
    invited_by_username,
    invited_to_user_id,
    invited_to_username,
    group_room_id,
    group_room_name
) => {
    return new Promise((resolve, reject) => {
        const invitation_id = uuidV4();
        mysqlInstance.query(
            `insert into group_room_invites_table values ("${invitation_id}", "${invited_by_user_id}","${invited_by_username}", "${invited_to_user_id}", "${invited_to_username}", "${group_room_id}", "${group_room_name}")`,
            (error1, response1) => {
                if (error1) {
                    console.log("insert invite", error1.message);
                    reject({ error: error1.message });
                    return;
                }
                console.log("invited", response1.affectedRows);
                resolve({ message: "invited" });
                return;
            }
        );
    });
};

const deleteInvitation = (invitation_id) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `delete from group_room_invites_table where invitation_id = "${invitation_id}"`,
            (error1, response1) => {
                if (error1) {
                    console.log("delete invite", error1.message);
                    reject({ error: error1.message });
                    return;
                }
                console.log("invitation deleted", response1.affectedRows);
                resolve({ message: "invitation deleted" });
                return;
            }
        );
    });
};

const getInvitationDetails = (invitation_id) => {
    return new Promise((resolve, reject) => {
        mysqlInstance.query(
            `select * from group_room_invites_table where invitation_id = "${invitation_id}"`,
            (error1, response1) => {
                if (error1) {
                    console.log("select invite", error1.message);
                    reject({ error: error1.message });
                    return;
                }
                console.log("invitation deleted", response1[0]);
                resolve({ response: response1[0] });
                return;
            }
        );
    });
};

const setRoomMessagesSeen = (
    room_id,
    my_details,
    should_allow_seen,
    socket
) => {
    // const query =
    //     "update messages_table  set `seen-by_at`" +
    //     `= '{"${
    //         my_details.user_id
    //     }":"${Date.now()}"}' where room_id = "${room_id}" and from_user_id != "${
    //         my_details.user_id
    //     }" and ` +
    // "ISNULL(`seen-by_at`)" +
    // " or !JSON_CONTAINS_PATH(`seen-by_at`,'one'," +
    // ` '$."${my_details.user_id}"');`;
    // console.log("setRoomMessagesSeen query", query);

    const query =
        "select message_id, `seen-by_at` " +
        `from messages_table where room_id="${room_id}" and from_user_id != "${my_details.user_id}" order by send_at desc`;

    mysqlInstance.query(query, (err, res) => {
        if (err) {
            return;
        }
        if (res.length > 0) {
            const message_ids = [];
            for (let i = 0; i < res.length; i++) {
                let ele = res[i];
                if (
                    ele["seen-by_at"] !== null &&
                    (Object.keys(ele["seen-by_at"]).includes(
                        my_details.user_id
                    ) ||
                        Object.keys(ele["seen-by_at"]).includes(
                            my_details.user_id + "_(no_seen_allowed)"
                        ))
                ) {
                    break;
                }
                if (
                    ele["seen-by_at"] === null ||
                    !Object.keys(ele["seen-by_at"]).includes(my_details.user_id)
                ) {
                    message_ids.push(ele.message_id);
                }
            }
            console.log("message_ids not seen", message_ids);
            if (message_ids.length !== 0) {
                const message_ids_string = JSON.stringify(message_ids)
                    .replace("[", "(")
                    .replace("]", ")");
                const now = Date.now();
                mysqlInstance.beginTransaction((err) => {
                    if (err) {
                        return;
                    }
                    const new_obj = should_allow_seen
                        ? ` '{"${my_details.user_id}": "${now}"}')`
                        : ` '{"${
                              my_details.user_id + "_(no_seen_allowed)"
                          }": ""}')`;
                    const q =
                        "update messages_table set `seen-by_at` = JSON_MERGE(if (ISNULL(`seen-by_at`)," +
                        ` "{}"` +
                        ", `seen-by_at`)," +
                        new_obj +
                        ` where message_id in ${message_ids_string}`;
                    console.log(q);
                    mysqlInstance.query(q, (err, res) => {
                        if (err) {
                            console.log("errr", err.message);
                            mysqlInstance.rollback(() => {
                                console.log("rollbacked");
                            });
                            return;
                        }
                        mysqlInstance.commit((err) => {
                            if (err) {
                                return;
                            }
                            console.log(res.affectedRows);
                            fetchRoomMessages(room_id, 15).then(
                                ({ messages }) => {
                                    socket.broadcast
                                        .to(room_id)
                                        .emit("room_messages", {
                                            room_id,
                                            messages,
                                        });
                                }
                            );
                        });
                    });
                });
            }
        }
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
    setActiveStatus,
    addInvitation,
    deleteInvitation,
    getInvitationDetails,
    setRoomMessagesSeen,
};
