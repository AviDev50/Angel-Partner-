import express from "express";
import cors from "cors";
import authRoutes from "./src/modules/auth/auth.routes.js"
import referenceRoutes from "./src/modules/references/references.routes.js";
const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/references", referenceRoutes);

export default app;