const express = require("express");
const mysqlInstance = require("../Configs/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const {
    getUserDataFromJWT,
    fetchUserFromUsername,
    updateToken,
    verifyToken,
    sendMessageToAllOnUserSignup,
} = require("./helpers");

const app = express();

app.post("/signup", (req, res) => {
    const { name, username, password, fcm_token } = req.body;
    if (
        name &&
        username &&
        password &&
        typeof name === "string" &&
        typeof username === "string" &&
        typeof password === "string"
    ) {
        const user_id = uuidv4();
        fetchUserFromUsername(username, "username").then(
            ({ response: response1 }) => {
                if (response1.length) {
                    res.status(409).send({ error: "Username already exists" });
                    return;
                }
                const token = jwt.sign(
                    { user_id, name, username, password, fcm_token },
                    process.env.SECRET_KEY
                );
                bcrypt
                    .genSalt(10)
                    .then((salt) => {
                        bcrypt.hash(
                            password,
                            salt,
                            (error, encryptedPassword) => {
                                if (error) throw error;
                                mysqlInstance.beginTransaction((err) => {
                                    if (err) throw error;
                                });
                                mysqlInstance.query(
                                    `
                insert into users_table (user_id, name, username, password, joined_at, jwt_token, fcm_token)
                values ("${user_id}", "${name}", "${username}", "${encryptedPassword}", "${Date.now()}", "${token}", "${fcm_token}")`,
                                    (error2, response2) => {
                                        if (error2) {
                                            mysqlInstance.rollback(() => {
                                                throw error2.message;
                                            });
                                        }
                                        if (response2) {
                                            console.log(
                                                "after signup",
                                                response2.affectedRows
                                            );
                                            res.locals.io.emit("refresh_all", {
                                                changed_by: user_id,
                                            });
                                            sendMessageToAllOnUserSignup(
                                                username,
                                                user_id
                                            );
                                            mysqlInstance.commit((err) => {
                                                if (err) throw err;
                                                console.log("commited");
                                                res.status(200).send({
                                                    message:
                                                        "User sign completed successfully.",
                                                    token,
                                                    user: {
                                                        user_id,
                                                        name,
                                                        username,
                                                        password,
                                                    },
                                                });
                                            });
                                            return;
                                        }
                                    }
                                );
                            }
                        );
                    })
                    .catch((e) => {
                        console.log("signup error", e);
                        res.status(500).send({ error: "Internal error." });
                        return;
                    });
            }
        );
    } else {
        res.status(400).send({ error: "Invalid data" });
        return;
    }
});

app.post("/login", (req, res) => {
    const { username, password, fcm_token } = req.body;
    console.log(username, password);
    if (
        username &&
        password &&
        typeof username === "string" &&
        typeof password === "string"
    ) {
        fetchUserFromUsername(username, "all")
            .then(({ response: response1 }) => {
                if (response1.length === 0) {
                    res.status(404).send({ error: "User not found." });
                    return;
                }
                console.log("response user found login", response1[0]);
                // if (response1[0].jwt_token !== "") {
                //     res.status(401).send({
                //         error: "User already logged in from somewhere.",
                //     });
                //     return;
                // }
                const {
                    user_id,
                    username,
                    password: hashedPassword,
                    name,
                } = response1[0];
                bcrypt
                    .compare(password, hashedPassword)
                    .then((isSame) => {
                        console.log(isSame);
                        if (isSame) {
                            const token = jwt.sign(
                                {
                                    user_id,
                                    username,
                                    password: hashedPassword,
                                    name,
                                    fcm_token,
                                },
                                process.env.SECRET_KEY
                            );
                            updateToken(token, user_id)
                                .then(({ response: response2 }) => {
                                    mysqlInstance.commit();
                                    res.status(200).send({
                                        message:
                                            "User login completed successfully",
                                        token,
                                        user: {
                                            user_id,
                                            username,
                                            name,
                                        },
                                    });
                                    return;
                                })
                                .catch((e) => {
                                    throw e;
                                });
                        } else {
                            res.status(403).send({
                                error: "Incorrect Password",
                            });
                        }
                    })
                    .catch((e) => {
                        throw e;
                    });
            })
            .catch((e) => {
                console.log("search user while login", e);
                res.status(500).send({ error: "Internal error" });
                return;
            });
    } else {
        res.status(400).send({ error: "Invalid data" });
        return;
    }
});

app.post("/logout", (req, res) => {
    const { token } = req.headers;
    if (token && typeof token === "string") {
        const data = getUserDataFromJWT(token);
        if (data) {
            try {
                mysqlInstance.query(
                    `select * from logged_in_users where user_id="${data.user_id}"`,
                    (error1, response1, fields1) => {
                        if (error1) {
                            console.log("fetching user from db", error1);
                            res.status(500).send({ error: "Internal error" });
                            return;
                        }
                        if (response1.length === 0) {
                            res.status(400).send({
                                error: "User already logged out from somewhere or not exists",
                            });
                            return;
                        }
                        updateToken("", data.user_id)
                            .then(({ response }) => {
                                res.status(200).send({
                                    message: "User logged out successfully.",
                                });
                                return;
                            })
                            .catch((e) => {
                                throw e;
                            });
                    }
                );
            } catch (err) {
                console.log("logout error", err);
                res.status(500).send({
                    error: "Internal error",
                });
                return;
            }
        } else {
            res.status(404).send({ error: "Token already expires." });
        }
    } else {
        res.status(400).send({ error: "Invalid data" });
        return;
    }
});

app.post("/verify_token", (req, res) => {
    const { token, fcm_token } = req.body;
    if (token && typeof token === "string") {
        console.log(token);
        verifyToken(token, fcm_token)
            .then(({ user, error }) => {
                if (error) {
                    res.status(404).send({
                        error: "Token was expired, as user logged out from somewhere",
                    });
                    return;
                }
                res.status(200).send({ message: "Verified.", user });
                return;
            })
            .catch((e) => {
                if (e.error === "Not Verified") {
                    res.status(400).send({
                        error: "Not verified",
                    });
                    return;
                }
                res.status(500).send({ error: "Internal error" });
                return;
            });
    } else {
        res.status(400).send({ error: "Invalid data" });
        return;
    }
});

app.post("/update_user_details", (req, res) => {
    const { token } = req.headers;
    if (token) {
        verifyToken(token)
            .then(({ error, user }) => {
                if (error) {
                    res.status(401).send({ error });
                    return;
                }
                if (user) {
                    const { username, name } = req.body;
                    let query = "";
                    let new_token = "";
                    if (username && name) {
                        query = `update users_table set username="${username}", name="${name}" where user_id="${user.user_id}"`;
                        new_token = jwt.sign(
                            {
                                user_id: user.user_id,
                                username,
                                password: user.password,
                                name,
                                fcm_token: user.fcm_token,
                            },
                            process.env.SECRET_KEY
                        );
                    } else if (username) {
                        query = `update users_table set username="${username}" where user_id="${user.user_id}"`;
                        new_token = jwt.sign(
                            {
                                user_id: user.user_id,
                                username,
                                password: user.password,
                                name: user.name,
                                fcm_token: user.fcm_token,
                            },
                            process.env.SECRET_KEY
                        );
                    } else if (name) {
                        query = `update users_table set name="${name}" where user_id="${user.user_id}"`;
                        new_token = jwt.sign(
                            {
                                user_id: user.user_id,
                                username: user.username,
                                password: user.password,
                                name,
                                fcm_token: user.fcm_token,
                            },
                            process.env.SECRET_KEY
                        );
                    } else {
                        res.status(400).send({ error: "Invalid data" });
                        return;
                    }
                    mysqlInstance.beginTransaction((err) => {
                        if (err) throw err;
                        mysqlInstance.query(query, (error, response) => {
                            if (error) throw error.message;
                            console.log(
                                "details updated",
                                response.affectedRows,
                                new_token,
                                token
                            );
                            mysqlInstance.commit((err) => {
                                if (err) throw err.message;
                                console.log("commited");
                                updateToken(new_token, user.user_id)
                                    .then(() => {
                                        res.locals.io.emit("refresh_all", {
                                            changed_by: user.user_id,
                                        });
                                        res.status(200).send({
                                            message: "User details updated",
                                            new_token,
                                        });
                                        return;
                                    })
                                    .catch((err) => {
                                        throw err;
                                    });
                            });
                        });
                    });
                }
            })
            .catch((e) => {
                if (e.error === "Not Verified") {
                    res.status(400).send({
                        error: "Not a valid token",
                    });
                    return;
                }
                res.status(500).send({ error: "Internal error" });
                return;
            });
    } else {
        res.status(401).send({ error: "Unauthorized user." });
    }
});

module.exports = app;
