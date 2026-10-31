import { listServices, registerService } from "../../../backend/services";

export const runtime = "nodejs";
export const GET = listServices;
export const POST = registerService;
