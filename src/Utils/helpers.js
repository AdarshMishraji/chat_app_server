const jwt = require("jsonwebtoken");
const mysqlInstance = require("./db");
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
        mysqlInstance.query(
            `update users_table set jwt_token="${token}" where user_id="${user_id}"`,
            (error1, response1) => {
                if (error1) {
                    console.log("update user error", error1);
                    reject({ error: error1.message });
                    return;
                }
                console.log("after logged in", response1.affectedRows);
                resolve({ response: response1 });
                return;
            }
        );
    });
};

const verifyToken = (token) => {
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
};
