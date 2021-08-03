const jwt = require("jsonwebtoken");
const mysqlInstance = require("./db");

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

module.exports = {
    getUserDataFromJWT,
    verifyToken,
    fetchUserFromUsername,
    fetchUserFromUserID,
    updateToken,
};
