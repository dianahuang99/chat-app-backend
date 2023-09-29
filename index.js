const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const Message = require("./models/Message");
const ws = require("ws");
const fs = require("fs");
const axios = require("axios");
const flash = require("express-flash");
const session = require("express-session");

dotenv.config();
mongoose.connect(process.env.MONGO_URL);
const jwtSecret = process.env.JWT_SECRET;
const bcryptSalt = bcrypt.genSaltSync(10);

const app = express();
app.use("/files", express.static(__dirname + "/files"));
app.use(express.json());
app.use(cookieParser());
const allowedOrigins = [process.env.CLIENT_URL, "http://localhost:5173"];
app.use(
  cors({
    credentials: true,
    origin: allowedOrigins,
  })
);

app.use(
  session({
    secret: process.env.SECRET_KEY,
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === "production", // Set to true in production for HTTPS
      sameSite: process.env.NODE_ENV === "development" ? "none" : "strict",
    },
  })
);

app.use(flash());

app.get("/api/flash-messages", (req, res) => {
  const flashMessages = req.flash();
  res.json({ flashMessages });
});

async function fetchUserDataFromToken(req) {
  const token = req.cookies ? req.cookies.token : undefined;
  if (!token) {
    throw new Error("no token in browser");
  }

  try {
    const userData = await jwt.verify(token, jwtSecret, {});
    return userData;
  } catch (err) {
    throw err;
  }
}
app.get("/joke", async (req, res) => {
  try {
    const response = await axios.get(
      "https://v2.jokeapi.dev/joke/Any?blacklistFlags=nsfw,religious,political,racist,sexist,explicit&type=single"
    );
    console.log(response.data);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/quote", async (req, res) => {
  try {
    const response = await axios.get("https://zenquotes.io/api/random");
    console.log(response.data[0]);
    res.json(response.data[0]);
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

https: app.get("/tarot", async (req, res) => {
  try {
    const response = await axios.get(
      "https://tarot-api-3hv5.onrender.com/api/v1/cards/random"
    );
    console.log(response.data.cards[0]);
    res.json(response.data.cards[0]);
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});
app.get("/messages/:userId", async (req, res) => {
  const { userId } = req.params;
  const userData = await fetchUserDataFromToken(req);
  const currUserId = userData.userId;
  const messages = await Message.find({
    sender: { $in: [userId, currUserId] },
    recipient: { $in: [userId, currUserId] },
  }).sort({ createdAt: 1 });
  res.json(messages);
});

app.get("/people", async (req, res) => {
  const users = await User.find({}, { _id: 1, username: 1 });
  res.json(users);
});

app.get("/profile", (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    jwt.verify(token, jwtSecret, {}, (err, userData) => {
      if (err) throw err;
      res.json(userData);
    });
  } else {
    res.status(401).json("no token");
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const foundUser = await User.findOne({ username });
    if (!foundUser) {
      console.log("user not found");
      req.flash("error", "Username or password is wrong");
      return res.redirect("/login");
    }

    if (foundUser) {
      const passOk = bcrypt.compareSync(password, foundUser.password);
      if (passOk) {
        jwt.sign(
          { userId: foundUser._id, username },
          jwtSecret,
          {},
          (err, token) => {
            res
              .cookie("token", token, { sameSite: "none", secure: true })
              .json({
                id: foundUser._id,
              });
          }
        );
      }
      if (!passOk) {
        console.log("user not found");
        req.flash("error", "Wrong username or password");
        return res.redirect("/login");
      }
    }
  } catch (error) {
    // Handle other types of errors
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/logout", (req, res) => {
  res.cookie("token", "", { sameSite: "none", secure: true }).json("ok");
});

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashedPassword = bcrypt.hashSync(password, bcryptSalt);
    const createdUser = await User.create({
      username: username,
      password: hashedPassword,
    });
    jwt.sign(
      { userId: createdUser._id, username },
      jwtSecret,
      {},
      (err, token) => {
        if (err) throw err;
        res
          .cookie("token", token, { sameSite: "none", secure: true })
          .status(201)
          .json({
            id: createdUser._id,
          });
      }
    );
  } catch (err) {
    // if (err) console.error(err);
    if (err.code === 11000) {
      // Duplicate key error (username already exists)
      console.log("Username already exists.");
      req.flash("error", "Sorry, username is taken");

      // res.status(400).json({ error: "Username already exists." });
      return res.redirect("/register");
    } else {
      // Other error
      console.log("Another error");
      req.flash("error", "An error occurred during user registration.");

      // res
      // .status(500)
      // .json({ error: "An error occurred during user registration." });
      return res.redirect("/register");
    }
  }
});

const server = app.listen(4040);

const wss = new ws.WebSocketServer({ server });
wss.on("connection", (connection, req) => {
  function showOnlineUsers() {
    const onlineUsers = Array.from(wss.clients).map((client) => ({
      userId: client.userId,
      username: client.username,
    }));

    wss.clients.forEach((client) => {
      client.send(JSON.stringify({ online: onlineUsers }));
    });
  }

  connection.isAlive = true;

  connection.timer = setInterval(() => {
    connection.ping();
    connection.deathTimer = setTimeout(() => {
      connection.isAlive = false;
      clearInterval(connection.timer);
      connection.terminate();
      showOnlineUsers();
      console.log("dead");
    }, 1000);
  }, 5000);

  connection.on("pong", () => {
    clearTimeout(connection.deathTimer);
  });

  // read username and id form the cookie for this connection
  const cookies = req.headers.cookie;
  if (cookies) {
    const cookieArray = cookies.split(";"); // Splitting the cookies string into an array
    let cookieStrToken = null;

    for (let i = 0; i < cookieArray.length && !cookieStrToken; i++) {
      const cookie = cookieArray[i].trim(); // Remove any leading or trailing spaces

      if (cookie.startsWith("token=")) {
        cookieStrToken = cookie;
      }
    }
    if (cookieStrToken) {
      const token = cookieStrToken.substring(cookieStrToken.indexOf("=") + 1);

      if (token) {
        jwt.verify(token, jwtSecret, {}, (err, userData) => {
          if (err) throw err;
          const { userId, username } = userData;
          connection.userId = userId;
          connection.username = username;
        });
      }
    }
  }

  showOnlineUsers();

  connection.on("message", async (msg) => {
    const messageData = JSON.parse(msg + "");
    const recipient = messageData.recipient;
    const text = messageData.text;
    const file = messageData.file;
    let filename = null;
    if (file) {
      const splitFile = file.name.split(".");
      const extension = splitFile.pop();
      filename = Date.now() + "." + extension;
      const path = __dirname + "/files/" + filename;
      const buffer = new Buffer.from(file.data.split(",")[1], "base64");
      fs.writeFile(path, buffer, () => {
        console.log("file saved:" + path);
      });
    }
    if (recipient && (text || file)) {
      const newMessage = await Message.create({
        sender: connection.userId,
        recipient,
        text,
        file: file ? filename : null,
      });
      for (const client of wss.clients) {
        if (client.userId === recipient) {
          const messagePayload = {
            text,
            sender: connection.userId,
            recipient,
            file: file ? filename : null,
            _id: newMessage._id,
          };
          client.send(JSON.stringify(messagePayload));
        }
      }
    }
  });
});
