var admin = require("firebase-admin");

var serviceAccount = require("./connect-you-38ab8-firebase-adminsdk-d33u4-042fa44488.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
