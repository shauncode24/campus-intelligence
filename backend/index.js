import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { handleChat } from "./chat.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.post("/ask", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Question required" });
    }

    const result = await handleChat(question);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(5000, () => {
  console.log("RAG backend running on http://localhost:5000");
});
