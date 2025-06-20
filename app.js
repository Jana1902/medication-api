const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();
app.use(
  cors({
    origin: ["http://localhost:3000"],
  })
);
app.use(express.json());

let dbPath = path.join(__dirname, "database.db");
let db = null;

let initializeDb = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is started");
    });

    await db.run(`
      CREATE TABLE IF NOT EXISTS user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('patient', 'caretaker'))
      );
    `);
  } catch (err) {
    console.log(err);
    process.exit(1);
  }
};

initializeDb();

let verifyUser = async (request, response, next) => {
  let jwtToken;
  let authHeaders = request.headers["authorization"];
  console.log(authHeaders);
  if (authHeaders !== undefined) {
    jwtToken = authHeaders.split(" ")[1];
  }
  if (jwtToken !== undefined) {
    jwt.verify(jwtToken, "jhfaiern23r4j", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        next();
      }
    });
  } else {
    response.status(401);
    response.send("Invalid JWT Token");
  }
};

//Login API
app.post("/login", async (request, response) => {
  let { username, password } = request.body;
  let getQuery = `SELECT * FROM user WHERE username = '${username}'`;
  let userDetail = await db.get(getQuery);

  if (userDetail !== undefined) {
    let isPasswordMatched = await bcrypt.compare(password, userDetail.password);
    if (isPasswordMatched) {
      let jwtToken;
      let payload = { username: userDetail.username };
      jwtToken = await jwt.sign(payload, "jhfaiern23r4j");
      response.send({
        jwtToken: jwtToken,
      });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

//Register API
app.post("/register", async (request, response) => {
  let { username, password, type, code } = request.body;
  let sqlQuery = `SELECT * FROM user WHERE username = '${username}'`;
  let isUserFound = await db.get(sqlQuery);

  if (isUserFound !== undefined) {
    response.status(400);
    response.send("User already exists");
    return;
  }

  if (type === "caretaker" && code !== "CARETAKER980") {
    response.status(400);
    response.send("Invalid caretaker code");
    return;
  }

  if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
    return;
  }

  let hashedPass = await bcrypt.hash(password, 10);
  let postQuery = `
    INSERT INTO user(username, password, type)
    VALUES('${username}', '${hashedPass}', '${type}');
  `;
  await db.run(postQuery);
  response.status(200);
  response.send("User created successfully");
});

module.exports = app;
