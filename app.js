import express from "express";
import cors from "cors";
import authRoutes from "./src/modules/auth/auth.routes.js";
import referenceRoutes from "./src/modules/references/references.routes.js";
import leadRoutes from "./src/modules/leads/leads.routes.js";
import userRoutes from "./src/modules/users/users.routes.js";
import unwantedLeadRoutes from "./src/modules/unwanted-leads/unwanted-leads.routes.js";
import siteVisitRoutes from "./src/modules/site-visits/site-visits.routes.js";
import walletRoutes from "./src/modules/wallet/wallet.routes.js";
import redemptions from "./src/modules/redemptions/redemptions.routes.js"
import bookingRoutes from "./src/modules/bookings/bookings.routes.js"
import commissionRoutes from "./src/modules/commissions/commissions.routes.js"
import notificationsRoutes from "./src/modules/notifications/notifications.routes.js"
import dashboardRoutes from "./src/modules/dashboard/dashboard.routes.js"
import reportsRoutes from "./src/modules/reports/reports.routes.js"
import helpRequestRoutes from "./src/modules/help_request/help-requests.routes.js";
import staticPageRoutes from "./src/modules/static-pages/static-pages.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/references", referenceRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/users", userRoutes);
app.use("/api/unwanted-leads", unwantedLeadRoutes);
app.use("/api/site-visits", siteVisitRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/redemptions", redemptions);
app.use("/api/bookings", bookingRoutes);
app.use("/api/commissions", commissionRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/help-requests", helpRequestRoutes);
app.use("/api/help-requests", helpRequestRoutes);
app.use("/api/pages", staticPageRoutes);


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