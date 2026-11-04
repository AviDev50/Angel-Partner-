import multer from "multer";
import path from "path";

// Storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/"); // folder name
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

// File filter (optional but recommended)
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only images allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB
  },
});

export default upload;

import { httpError } from "../utils/httpError.js";
import crypto from "crypto";

const PHOTO_TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

const photoUploader = multer({
  storage: multer.diskStorage({
    destination: "uploads", // string dena => multer folder khud bana deta hai
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${PHOTO_TYPES[file.mimetype]}`),
  }),
  fileFilter: (req, file, cb) =>
    PHOTO_TYPES[file.mimetype]
      ? cb(null, true)
      : cb(httpError(400, "Only JPG, PNG or WEBP images are allowed"), false),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

// Exactly 1 photo. Multer ke errors ko 500 ki jagah 400 banata hai.
export function uploadPhoto(field = "photo") {
  const handler = photoUploader.single(field);
  return (req, res, next) =>
    handler(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const msg =
          err.code === "LIMIT_FILE_SIZE" ? "Photo must be 2MB or smaller"
          : err.code === "LIMIT_UNEXPECTED_FILE" ? `Send exactly one image in field '${field}'`
          : err.message;
        return next(httpError(400, msg));
      }
      next(err);
    });
}