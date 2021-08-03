const mysql = require("mysql2");
const dotenv = require("dotenv");
dotenv.config();

const { DB_HOST, DB_USER, DB_PASSOWORD, DB } = process.env;

const connection = mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSOWORD,
    database: DB,
});

connection.connect((err) => {
    if (err) console.log(err);
    else console.log("Successfully connected to mysql database.");
});

module.exports = connection;
