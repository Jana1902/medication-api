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
    origin: [
      "http://localhost:3000", // for local testing
      "https://medication-manaegment.vercel.app", // your Vercel frontend URL
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true, // if you're sending cookies or auth headers
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

    await db.run(`CREATE TABLE IF NOT EXISTS caretaker_patient (
    caretaker_id INTEGER,
    patient_id INTEGER,
    PRIMARY KEY (caretaker_id, patient_id),
    FOREIGN KEY (caretaker_id) REFERENCES user(id),
    FOREIGN KEY (patient_id) REFERENCES user(id)
  )`);

    await db.run(`CREATE TABLE IF NOT EXISTS medication_plan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    name TEXT NOT NULL,
    dosage TEXT,
    frequency TEXT,
    time TEXT,
    start_date DATE,
    end_date DATE,
    FOREIGN KEY (patient_id) REFERENCES user(id)
  )`);

    await db.run(`CREATE TABLE IF NOT EXISTS daily_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medication_id INTEGER,
    action_date DATE,
    status TEXT CHECK (status IN ('pending', 'taken', 'missed')) DEFAULT 'pending',
    notes TEXT,
    FOREIGN KEY (medication_id) REFERENCES medication_plan(id)
  )`);
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
  let { username, password, type } = request.body;

  let getQuery = `SELECT * FROM user WHERE username = '${username}'`;
  let userDetail = await db.get(getQuery);

  if (userDetail !== undefined) {
    if (userDetail.type !== type) {
      response.status(400);
      response.send("Invalid user type selected");
      return;
    }

    let isPasswordMatched = await bcrypt.compare(password, userDetail.password);
    if (isPasswordMatched) {
      let payload = { username: userDetail.username, type: userDetail.type };
      let jwtToken = await jwt.sign(payload, "jhfaiern23r4j");

      response.send({
        jwtToken,
        username: userDetail.username,
        userid: userDetail.id,
        type: userDetail.type,
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

app.get("/patients", verifyUser, async (req, res) => {
  const caretakerUsername = req.query.caretaker;

  const query = `
    SELECT p.id, p.username as name
    FROM user p
    JOIN caretaker_patient cp ON cp.patient_id = p.id
    JOIN user c ON c.id = cp.caretaker_id
    WHERE c.username = ? AND p.type = 'patient'
  `;

  try {
    const rows = await db.all(query, [caretakerUsername]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/medications", async (req, res) => {
  const caretakerUsername = req.query.caretaker;

  const query = `
    SELECT * FROM medication_plan
WHERE patient_id = (SELECT id FROM user WHERE username = ? AND type = 'patient');
  `;

  try {
    const rows = await db.all(query, [caretakerUsername]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/add-medication", async (req, res) => {
  const { patient_id, name, dosage, frequency, time, start_date, end_date } =
    req.body;

  const insert = `
    INSERT INTO medication_plan (patient_id, name, dosage, frequency, time, start_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  try {
    const result = await db.run(insert, [
      patient_id,
      name,
      dosage,
      frequency,
      time,
      start_date,
      end_date,
    ]);
    res.json({ success: true, id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/add-patient", async (req, res) => {
  const { name, password, caretakerId } = req.body;

  try {
    const existingUser = await db.get(`SELECT * FROM user WHERE username = ?`, [
      name,
    ]);
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" });
    }

    if (!password || password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters long" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert patient into user table
    const result = await db.run(
      `INSERT INTO user (username, password, type) VALUES (?, ?, 'patient')`,
      [name, hashedPassword]
    );

    const patientId = result.lastID;

    // Link to caretaker
    await db.run(
      `INSERT INTO caretaker_patient (caretaker_id, patient_id) VALUES (?, ?)`,
      [caretakerId, patientId]
    );

    res.json({ success: true, patientId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/patient/:id/streak", verifyUser, async (req, res) => {
  const { id } = req.params;
  const query = `
    SELECT action_date, status FROM daily_actions
    WHERE medication_id IN (
      SELECT id FROM medication_plan WHERE patient_id = ?
    ) AND status = 'taken'
    ORDER BY action_date DESC
  `;
  try {
    const actions = await db.all(query, [id]);
    let streak = 0;
    let currentDate = new Date();
    for (const action of actions) {
      const actionDate = new Date(action.action_date);
      if (actionDate.toDateString() === currentDate.toDateString()) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else {
        break;
      }
    }
    res.json({ streak });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Today's Status API
app.get("/patient/:id/today-status", verifyUser, async (req, res) => {
  const { id } = req.params;
  const today = new Date().toISOString().split("T")[0];
  const query = `
    SELECT status FROM daily_actions
    WHERE medication_id IN (
      SELECT id FROM medication_plan WHERE patient_id = ?
    ) AND action_date = ?
  `;
  try {
    const rows = await db.all(query, [id, today]);
    const taken = rows.filter((r) => r.status === "taken").length;
    const pending = rows.filter((r) => r.status === "pending").length;
    const missed = rows.filter((r) => r.status === "missed").length;

    let status = "pending";
    if (taken === rows.length) status = "taken";
    else if (missed > 0 && taken === 0) status = "missed";

    res.json({ total: rows.length, taken, pending, missed, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Monthly Completion Percentage API
app.get("/patient/:id/monthly-percentage", verifyUser, async (req, res) => {
  const { id } = req.params;
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const startDate = `${year}-${month}-01`;
  const endDate = `${year}-${month}-31`;

  const query = `
    SELECT status FROM daily_actions
    WHERE medication_id IN (
      SELECT id FROM medication_plan WHERE patient_id = ?
    ) AND action_date BETWEEN ? AND ?
  `;
  try {
    const rows = await db.all(query, [id, startDate, endDate]);
    const total = rows.length;
    const taken = rows.filter((r) => r.status === "taken").length;
    const percentage = total > 0 ? Math.round((taken / total) * 100) : 0;
    res.json({ total, taken, percentage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/caretaker-dashboard", verifyUser, async (req, res) => {
  const { username } = req.query;

  try {
    const totalPatientsQuery = `
      SELECT COUNT(*) AS count
      FROM caretaker_patient cp
      JOIN user c ON cp.caretaker_id = c.id
      WHERE c.username = ?;
    `;
    const totalMedicationsQuery = `
      SELECT COUNT(*) AS count
      FROM medication_plan mp
      JOIN caretaker_patient cp ON mp.patient_id = cp.patient_id
      JOIN user c ON cp.caretaker_id = c.id
      WHERE c.username = ?;
    `;
    const takenTodayQuery = `
      SELECT COUNT(DISTINCT mp.patient_id) AS count
      FROM daily_actions da
      JOIN medication_plan mp ON da.medication_id = mp.id
      JOIN caretaker_patient cp ON mp.patient_id = cp.patient_id
      JOIN user c ON cp.caretaker_id = c.id
      WHERE da.action_date = date('now') AND da.status = 'taken' AND c.username = ?;
    `;
    const pendingTodayQuery = `
      SELECT COUNT(DISTINCT mp.patient_id) AS count
      FROM daily_actions da
      JOIN medication_plan mp ON da.medication_id = mp.id
      JOIN caretaker_patient cp ON mp.patient_id = cp.patient_id
      JOIN user c ON cp.caretaker_id = c.id
      WHERE da.action_date = date('now') AND da.status = 'pending' AND c.username = ?;
    `;

    const [patients, medications, taken, pending] = await Promise.all([
      db.get(totalPatientsQuery, username),
      db.get(totalMedicationsQuery, username),
      db.get(takenTodayQuery, username),
      db.get(pendingTodayQuery, username),
    ]);

    res.json({
      patients: patients.count,
      medications: medications.count,
      taken: taken.count,
      pending: pending.count,
    });
  } catch (err) {
    console.error("Error in caretaker dashboard:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
