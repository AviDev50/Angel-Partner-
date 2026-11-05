import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { readFileSync } from "fs";
import path from "path";

const keyPath = path.resolve(
  process.env.FIREBASE_SERVICE_ACCOUNT || "./firebase-service-account.json",
);

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert(JSON.parse(readFileSync(keyPath, "utf8"))),
    });

export const messaging = getMessaging(app);