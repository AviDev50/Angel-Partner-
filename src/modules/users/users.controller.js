import * as userService from "./users.service.js";
import { sendError } from "../../utils/httpError.js";

export async function createUser(req, res) {
  try {
    const data = await userService.createSalesUserService(req.body);
    res.status(201).json({ success: true, message: "Sales user created", data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function listUsers(req, res) {
  try {
    const data = await userService.listUsersService(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getUser(req, res) {
  try {
    const data = await userService.getUserService(req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function updateUserStatus(req, res) {
  try {
    const data = await userService.updateUserStatusService(req.params.id, req.body);
    res.status(200).json({ success: true, message: `User marked as ${data.status}`, data });
  } catch (error) {
    sendError(res, error);
  }
}