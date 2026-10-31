import {
  handlePaymentPost,
  handleSettlementPut,
  handleStatusGet,
} from "../../backend/api";

export const GET = handleStatusGet;
export const POST = handlePaymentPost;
export const PUT = handleSettlementPut;
