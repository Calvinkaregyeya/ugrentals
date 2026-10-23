import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The app is built here but NOT started. That lets tests import it and
// attach it to any free port, while server.js starts it for real use.
export const app = express();

app.use(express.static(path.join(__dirname, "public")));

app.get("/api", (req, res) => {
  res.json({
    success: true,
    message: "Operation successful",
    data: "Welcome to Osebo API!!!",
  });
});
