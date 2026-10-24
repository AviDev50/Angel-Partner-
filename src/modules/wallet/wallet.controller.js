import * as service from "./wallet.service.js";
import { sendError } from "../../utils/httpError.js";

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const getMyWallet = handle((req) => service.getWalletService(req.user.user_id));
export const listMyTransactions = handle((req) =>
  service.listTransactionsService(req.user, { ...req.query, partner_id: req.user.user_id }),
);
export const getPartnerWallet = handle((req) => service.getPartnerWalletService(req.params.partnerId));
export const listPartnerTransactions = handle((req) =>
  service.listPartnerTransactionsService(req.user, req.params.partnerId, req.query),
);
export const listAllTransactions = handle((req) => service.listTransactionsService(req.user, req.query));