import * as service from "./bookings.service.js";
import { sendError } from "../../utils/httpError.js";

export async function createBooking(req, res) {
  try {
    const data = await service.createBookingService(req.user, req.body);
    res.status(201).json({ success: true, message: "Booking submitted for verification", data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function listBookings(req, res) {
  try {
    const data = await service.listBookingsService(req.user, req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getBooking(req, res) {
  try {
    const data = await service.getBookingService(req.user, req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function verifyBooking(req, res) {
  try {
    const data = await service.verifyBookingService(req.user, req.params.id, req.body);
    res.status(200).json({ success: true, message: `Booking ${data.booking_status}`, data });
  } catch (error) {
    sendError(res, error);
  }
}