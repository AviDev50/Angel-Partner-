import express from "express";
import cors from "cors";
import authRoutes from "./src/modules/auth/auth.routes.js";
import referenceRoutes from "./src/modules/references/references.routes.js";
import leadRoutes from "./src/modules/leads/leads.routes.js";
import userRoutes from "./src/modules/users/users.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/references", referenceRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/users", userRoutes);

// JSON 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    success: false,
    message: err.status ? err.message : "Internal server error",
  });
});

export default app;