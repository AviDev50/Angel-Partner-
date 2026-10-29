import * as authService from "./auth.service.js";

export async function register(req, res) {
  try {
    const result = await authService.registerService(req.body);

    res.status(201).json({
      success: true,
      message: "Registration successful",
      data: result,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message,
    });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body;

    const result = await authService.loginService(email, password);

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message,
    });
  }
}

export async function me(req, res) {
  try {
    const user = await authService.getMeService(req.user.user_id);

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message,
    });
  }
}

export async function refresh(req, res) {
  try {
    const result = await authService.refreshService(req.body.refresh_token);
    res.status(200).json({ success: true, message: "Token refreshed", data: result });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
}

export async function logout(req, res) {
  try {
    await authService.logoutService(req.body.refresh_token);
    res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
}

export async function logoutAll(req, res) {
  try {
    await authService.logoutAllService(req.user.user_id);
    res.status(200).json({ success: true, message: "Logged out from all devices" });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
}