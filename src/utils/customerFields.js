import { httpError } from "./httpError.js";
import { normalizeMobile, isValidEmail } from "./validators.js";

export function optionalString(value, max, field) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > max) throw httpError(400, `${field} must be at most ${max} characters`);
  return s;
}

export function parseCustomerFields(body) {
  const customer_name = optionalString(body.customer_name, 150, "customer_name");
  if (!customer_name) throw httpError(400, "customer_name is required");

  const customer_mobile = normalizeMobile(body.customer_mobile);
  if (!customer_mobile) throw httpError(400, "customer_mobile must be a valid 10-digit mobile number");

  let customer_email = optionalString(body.customer_email, 190, "customer_email");
  if (customer_email) {
    customer_email = customer_email.toLowerCase();
    if (!isValidEmail(customer_email)) throw httpError(400, "customer_email is invalid");
  }

  let customer_budget = null;
  const b = body.customer_budget;
  if (b !== undefined && b !== null && b !== "") {
    customer_budget = Number(b);
    if (!Number.isFinite(customer_budget) || customer_budget <= 0 || customer_budget >= 1e12) {
      throw httpError(400, "customer_budget must be a positive number");
    }
  }

  return {
    customer_name,
    customer_mobile,
    customer_email,
    preferred_bhk: optionalString(body.preferred_bhk, 30, "preferred_bhk"),
    customer_budget,
    preferred_project_location: optionalString(body.preferred_project_location, 255, "preferred_project_location"),
    remarks: optionalString(body.remarks, 5000, "remarks"),
  };
}